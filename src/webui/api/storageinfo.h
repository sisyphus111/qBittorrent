/* This file is part of qBittorrent and is licensed under GPL-2.0-or-later. */
#pragma once

#include <QJsonObject>

namespace WebUIStorage
{
    // Returns a shared, asynchronously refreshed snapshot. Torrent objects are
    // only accessed on the application thread; filesystem queries run off-thread.
    QJsonObject snapshot(bool forceRefresh = false);
}
