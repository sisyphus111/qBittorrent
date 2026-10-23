/* This file is part of qBittorrent and is licensed under GPL-2.0-or-later. */
#include "storageinfo.h"

#include <algorithm>
#include <chrono>
#include <future>
#include <limits>
#include <utility>

#include <QDateTime>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QHash>
#include <QJsonArray>
#include <QList>
#include <QSet>
#include <QStorageInfo>
#include <QStringList>

#ifdef Q_OS_UNIX
#include <sys/stat.h>
#endif

#include "base/bittorrent/session.h"
#include "base/bittorrent/torrent.h"
#include "base/global.h"

using namespace Qt::Literals::StringLiterals;
using namespace std::chrono_literals;

namespace
{
    const QString SCAN_ROOT = u"/mnt"_s;
    constexpr auto REFRESH_INTERVAL = 3s;

    struct Task
    {
        QString destination;
        QString current;
        qint64 wanted = 0;
        qint64 completed = 0;
        bool metadata = false;
        bool unsettled = false;
    };

    struct Volume
    {
        QString id;
        QStringList paths;
        QStringList writablePaths;
        qint64 total = -1;
        qint64 used = -1;
        qint64 available = -1;
        qint64 reserved = 0;
        qint64 pending = 0;
        int taskCount = 0;
        int unknownCount = 0;
        int unsettledCount = 0;
        int crossVolumeCount = 0;
    };

    QString volumeId(const QStorageInfo &storage)
    {
        // Bind mounts and subvolumes sharing a filesystem share its capacity.
#ifdef Q_OS_UNIX
        // Mount source names are not unique (e.g. independent tmpfs mounts may
        // all be named "tmpfs"). The kernel device ID identifies the filesystem.
        struct stat info {};
        if (::stat(QFile::encodeName(storage.rootPath()).constData(), &info) == 0)
            return u"device:"_s + QString::number(static_cast<qulonglong>(info.st_dev));
#endif
        return QString::fromLatin1(storage.device().toBase64()) + u':'
            + QString::fromLatin1(storage.fileSystemType().toBase64());
    }

    void addBytes(qint64 &total, const qint64 value)
    {
        total += std::min(std::max<qint64>(0, value), std::numeric_limits<qint64>::max() - total);
    }

    QJsonObject scan(const QList<Task> &tasks, const bool preallocation)
    {
        QSet<QString> candidates;
        const QDir root {SCAN_ROOT};
        for (const QFileInfo &entry : root.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot | QDir::NoSymLinks))
            candidates.insert(entry.absoluteFilePath());
        for (const QStorageInfo &storage : QStorageInfo::mountedVolumes())
        {
            if (storage.rootPath().startsWith(SCAN_ROOT + u'/'))
                candidates.insert(storage.rootPath());
        }

        QStringList sortedPaths = candidates.values();
        sortedPaths.sort();
        QList<Volume> volumes;
        QHash<QString, qsizetype> volumeIndexes;
        for (const QString &path : sortedPaths)
        {
            const QFileInfo directory {path};
            const QStorageInfo storage {path};
            const bool mounted = storage.isValid() && storage.isReady()
                && (storage.bytesTotal() > 0) && (storage.bytesFree() >= 0)
                && (storage.bytesAvailable() >= 0)
                && (QDir::cleanPath(storage.rootPath()) == directory.canonicalFilePath());
            const QString id = mounted ? volumeId(storage) : (u"unmounted:"_s + path);
            if (!volumeIndexes.contains(id))
            {
                Volume volume;
                volume.id = id;
                if (mounted)
                {
                    volume.total = storage.bytesTotal();
                    const qint64 free = std::clamp(storage.bytesFree(), qint64(0), volume.total);
                    volume.used = volume.total - free;
                    volume.available = std::clamp(storage.bytesAvailable(), qint64(0), free);
                    volume.reserved = free - volume.available;
                }
                volumeIndexes.insert(id, volumes.size());
                volumes.append(volume);
            }
            Volume &volume = volumes[volumeIndexes.value(id)];
            volume.paths.append(path);
            if (mounted && !storage.isReadOnly() && directory.isWritable())
                volume.writablePaths.append(path);
        }

        QHash<QString, qsizetype> pathCache;
        const auto resolve = [&volumes, &volumeIndexes, &pathCache](const QString &path) -> qsizetype
        {
            if (path.isEmpty())
                return -1;
            if (pathCache.contains(path))
                return pathCache.value(path);
            QString ancestor = QDir::cleanPath(path);
            while (!QFileInfo::exists(ancestor))
            {
                const QString parent = QFileInfo(ancestor).absolutePath();
                if (parent == ancestor)
                    break;
                ancestor = parent;
            }
            const QStorageInfo storage {ancestor};
            qsizetype index = volumeIndexes.value(volumeId(storage), -1);
            if (index < 0)
            {
                // A removed mount must not silently fall back to the system disk.
                qsizetype longest = 0;
                for (qsizetype i = 0; i < volumes.size(); ++i)
                {
                    for (const QString &rootPath : volumes[i].paths)
                    {
                        if ((rootPath.size() > longest)
                            && ((path == rootPath) || path.startsWith(rootPath + u'/')))
                        {
                            index = i;
                            longest = rootPath.size();
                        }
                    }
                }
            }
            pathCache.insert(path, index);
            return index;
        };

        int unmappedTasks = 0;
        for (const Task &task : tasks)
        {
            const qsizetype destination = resolve(task.destination);
            const qsizetype current = resolve(task.current);
            if (destination < 0)
                ++unmappedTasks;
            QSet<qsizetype> affected {destination, current};
            affected.remove(-1);
            for (const qsizetype index : affected)
            {
                ++volumes[index].taskCount;
                if (!task.metadata)
                    ++volumes[index].unknownCount;
                else if (task.unsettled)
                    ++volumes[index].unsettledCount;
            }
            // Checking/moving existing files is not the same as allocating new data.
            // Report these tasks as uncertain until their counters settle.
            if (!task.metadata || task.unsettled)
                continue;
            const qint64 remaining = std::max<qint64>(0, task.wanted - std::max<qint64>(0, task.completed));
            if (current == destination)
            {
                if (destination >= 0)
                    addBytes(volumes[destination].pending, remaining);
            }
            else
            {
                // Cross-filesystem moves may temporarily require both copies.
                // Reserve the complete selected payload at the destination and the
                // remaining bytes at the current location; do not credit future deletion.
                if (destination >= 0)
                {
                    addBytes(volumes[destination].pending, task.wanted);
                    ++volumes[destination].crossVolumeCount;
                }
                if (current >= 0)
                {
                    addBytes(volumes[current].pending, remaining);
                    ++volumes[current].crossVolumeCount;
                }
            }
        }

        QJsonArray result;
        for (const Volume &volume : volumes)
        {
            result.append(QJsonObject {
                {u"id"_s, volume.id},
                {u"label"_s, QFileInfo(volume.paths.first()).fileName()},
                {u"paths"_s, QJsonArray::fromStringList(volume.paths)},
                {u"writable_paths"_s, QJsonArray::fromStringList(volume.writablePaths)},
                {u"mounted"_s, volume.total >= 0},
                {u"total"_s, volume.total},
                {u"used"_s, volume.used},
                {u"reserved"_s, volume.reserved},
                {u"available"_s, volume.available},
                {u"pending"_s, volume.pending},
                {u"projected_free"_s, volume.total >= 0 ? std::max<qint64>(0, volume.available - volume.pending) : qint64(-1)},
                {u"shortfall"_s, volume.total >= 0 ? std::max<qint64>(0, volume.pending - volume.available) : qint64(0)},
                {u"task_count"_s, volume.taskCount},
                {u"unknown_count"_s, volume.unknownCount},
                {u"unsettled_count"_s, volume.unsettledCount},
                {u"cross_volume_count"_s, volume.crossVolumeCount}
            });
        }
        return {
            {u"scan_root"_s, SCAN_ROOT},
            {u"volumes"_s, result},
            {u"sampled_at"_s, QDateTime::currentMSecsSinceEpoch()},
            {u"unmapped_tasks"_s, unmappedTasks},
            {u"preallocation"_s, preallocation}
        };
    }
}

QJsonObject WebUIStorage::snapshot(const bool forceRefresh)
{
    // API controllers are session-scoped; the cache is deliberately shared so
    // multiple clients do not independently scan mounted filesystems.
    static std::future<QJsonObject> pending;
    static QJsonObject cached;
    static QElapsedTimer lastScan;
    static bool rescanRequested = false;
    rescanRequested = rescanRequested || forceRefresh;
    if (pending.valid() && (pending.wait_for(0s) == std::future_status::ready))
        cached = pending.get();
    if (!pending.valid() && (rescanRequested || !lastScan.isValid() || (lastScan.elapsed() >= std::chrono::duration_cast<std::chrono::milliseconds>(REFRESH_INTERVAL).count())))
    {
        QList<Task> tasks;
        const auto *session = BitTorrent::Session::instance();
        for (const BitTorrent::Torrent *torrent : session->torrents())
        {
            const QString destination = torrent->savePath().toString();
            const QString actual = torrent->actualStorageLocation().toString();
            const QString temporary = torrent->downloadPath().toString();
            tasks.append({destination, !actual.isEmpty() ? actual : (!temporary.isEmpty() ? temporary : destination),
                torrent->wantedSize(), torrent->completedSize(), torrent->hasMetadata(), torrent->isChecking() || torrent->isMoving()});
        }
        const bool preallocation = session->isPreallocationEnabled();
        pending = std::async(std::launch::async, [tasks = std::move(tasks), preallocation] { return scan(tasks, preallocation); });
        rescanRequested = false;
        lastScan.start();
    }
    QJsonObject result = cached;
    result.insert(u"refreshing"_s, pending.valid());
    if (cached.isEmpty())
    {
        result.insert(u"scan_root"_s, SCAN_ROOT);
        result.insert(u"volumes"_s, QJsonArray {});
    }
    return result;
}
