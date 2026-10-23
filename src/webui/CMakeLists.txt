add_library(qbt_webui STATIC
    # headers
    api/apicontroller.h
    api/apierror.h
    api/apistatus.h
    api/appcontroller.h
    api/authcontroller.h
    api/clientdatacontroller.h
    api/isessionmanager.h
    api/logcontroller.h
    api/rsscontroller.h
    api/searchcontroller.h
    api/synccontroller.h
    api/storageinfo.h
    api/torrentcreatorcontroller.h
    api/torrentscontroller.h
    api/transfercontroller.h
    api/serialize/serialize_torrent.h
    clientdatastorage.h
    searchjobmanager.h
    webapplication.h
    websession.h
    webui.h

    # sources
    api/apicontroller.cpp
    api/apierror.cpp
    api/appcontroller.cpp
    api/authcontroller.cpp
    api/clientdatacontroller.cpp
    api/logcontroller.cpp
    api/rsscontroller.cpp
    api/searchcontroller.cpp
    api/synccontroller.cpp
    api/storageinfo.cpp
    api/torrentcreatorcontroller.cpp
    api/torrentscontroller.cpp
    api/transfercontroller.cpp
    api/serialize/serialize_torrent.cpp
    clientdatastorage.cpp
    searchjobmanager.cpp
    webapplication.cpp
    websession.cpp
    webui.cpp
)

find_program(NPM_EXECUTABLE npm REQUIRED)
set(modern_source_dir "${CMAKE_CURRENT_SOURCE_DIR}/modern")
set(modern_output_dir "${CMAKE_CURRENT_BINARY_DIR}/modern/dist")
set(modern_dependencies "${CMAKE_CURRENT_BINARY_DIR}/modern/dependencies.stamp")
file(GLOB_RECURSE modern_sources CONFIGURE_DEPENDS
    "${modern_source_dir}/src/*.vue"
    "${modern_source_dir}/src/*.ts"
    "${modern_source_dir}/src/*.css"
)
add_custom_command(
    OUTPUT "${modern_dependencies}" "${modern_source_dir}/node_modules/.package-lock.json"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${modern_output_dir}"
    COMMAND "${NPM_EXECUTABLE}" ci --no-audit --no-fund
    COMMAND "${CMAKE_COMMAND}" -E touch "${modern_dependencies}"
    WORKING_DIRECTORY "${modern_source_dir}"
    DEPENDS "${modern_source_dir}/package.json" "${modern_source_dir}/package-lock.json"
    COMMENT "Installing modern WebUI build dependencies"
    VERBATIM
)
set(modern_outputs
    "${modern_output_dir}/index.html"
    "${modern_output_dir}/modern/assets/app.js"
    "${modern_output_dir}/modern/assets/app.css"
)
add_custom_command(
    OUTPUT ${modern_outputs}
    COMMAND "${NPM_EXECUTABLE}" run build -- --outDir "${modern_output_dir}"
    WORKING_DIRECTORY "${modern_source_dir}"
    DEPENDS ${modern_sources}
        "${modern_source_dir}/index.html"
        "${modern_source_dir}/vite.config.ts"
        "${modern_source_dir}/tsconfig.json"
        "${modern_dependencies}"
        "${modern_source_dir}/node_modules/.package-lock.json"
    COMMENT "Building modern WebUI"
    VERBATIM
)
add_custom_target(qbt_modern_webui DEPENDS ${modern_outputs})
add_dependencies(qbt_webui qbt_modern_webui)
configure_file(modern/webui.qrc.in modern/modern.qrc @ONLY)
target_sources(qbt_webui INTERFACE www/webui.qrc "${CMAKE_CURRENT_BINARY_DIR}/modern/modern.qrc")

target_link_libraries(qbt_webui PRIVATE qbt_base)
