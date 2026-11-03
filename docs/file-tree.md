# Árvore completa dos fontes

```text
highpass-p2p-engine/
├── .github/
│   └── workflows/
│       ├── ci-cd.yml
│       └── deploy.yml
├── apps/
│   ├── android/
│   │   ├── app/
│   │   │   ├── src/
│   │   │   │   ├── main/
│   │   │   │   │   ├── java/
│   │   │   │   │   │   └── com/
│   │   │   │   │   │       └── highpass/
│   │   │   │   │   │           └── player/
│   │   │   │   │   │               ├── AppUpdates.kt
│   │   │   │   │   │               ├── ArtworkLoader.kt
│   │   │   │   │   │               ├── CatalogAdapter.kt
│   │   │   │   │   │               ├── DetailsActivity.kt
│   │   │   │   │   │               ├── EngineApi.kt
│   │   │   │   │   │               ├── HomeActivity.kt
│   │   │   │   │   │               ├── LibraryStore.kt
│   │   │   │   │   │               ├── LoginActivity.kt
│   │   │   │   │   │               ├── P2PBridge.kt
│   │   │   │   │   │               ├── P2PDataSource.kt
│   │   │   │   │   │               ├── PlayerActivity.kt
│   │   │   │   │   │               ├── PlayerTheme.kt
│   │   │   │   │   │               ├── SegmentBuffer.kt
│   │   │   │   │   │               ├── SessionStore.kt
│   │   │   │   │   │               ├── UpdateActivity.kt
│   │   │   │   │   │               ├── UpdateFileProvider.kt
│   │   │   │   │   │               └── UpdatePolicy.kt
│   │   │   │   │   ├── res/
│   │   │   │   │   │   ├── drawable/
│   │   │   │   │   │   │   ├── ic_highpass.xml
│   │   │   │   │   │   │   └── tv_banner.xml
│   │   │   │   │   │   ├── layout/
│   │   │   │   │   │   │   └── activity_login.xml
│   │   │   │   │   │   ├── values/
│   │   │   │   │   │   │   └── styles.xml
│   │   │   │   │   │   └── xml/
│   │   │   │   │   │       ├── network_security_config.xml
│   │   │   │   │   │       └── update_paths.xml
│   │   │   │   │   └── AndroidManifest.xml
│   │   │   │   └── test/
│   │   │   │       └── java/
│   │   │   │           └── com/
│   │   │   │               └── highpass/
│   │   │   │                   └── player/
│   │   │   │                       ├── SegmentBufferTest.kt
│   │   │   │                       └── UpdatePolicyTest.kt
│   │   │   └── build.gradle.kts
│   │   ├── gradle/
│   │   │   └── wrapper/
│   │   │       ├── gradle-wrapper.jar
│   │   │       └── gradle-wrapper.properties
│   │   ├── README.md
│   │   ├── build.gradle.kts
│   │   ├── gradle.properties
│   │   ├── gradlew
│   │   ├── gradlew.bat
│   │   └── settings.gradle.kts
│   ├── roku/
│   │   ├── components/
│   │   │   ├── ApiTask.brs
│   │   │   ├── ApiTask.xml
│   │   │   ├── HighpassCard.brs
│   │   │   ├── HighpassCard.xml
│   │   │   ├── HighpassScene.brs
│   │   │   └── HighpassScene.xml
│   │   ├── images/
│   │   │   ├── icon.png
│   │   │   └── splash.png
│   │   ├── source/
│   │   │   └── main.brs
│   │   ├── bsconfig.json
│   │   └── manifest
│   ├── tizen/
│   │   ├── config.xml
│   │   ├── icon.png
│   │   ├── index.html
│   │   └── launch.js
│   ├── webos/
│   │   ├── appinfo.json
│   │   ├── icon.png
│   │   ├── index.html
│   │   ├── largeIcon.png
│   │   └── launch.js
│   └── webplayer/
│       ├── src/
│       │   ├── components/
│       │   │   ├── ClientUpdates.tsx
│       │   │   └── P2PVideoPlayer.tsx
│       │   ├── p2p/
│       │   │   ├── android-bridge.ts
│       │   │   ├── browser-seed.ts
│       │   │   ├── delivery-policy.ts
│       │   │   ├── native-core.ts
│       │   │   ├── seed-storage.ts
│       │   │   ├── stats.ts
│       │   │   └── telemetry.ts
│       │   ├── App.tsx
│       │   ├── Login.tsx
│       │   ├── api.ts
│       │   ├── main.tsx
│       │   ├── styles.css
│       │   └── tv-navigation.ts
│       ├── android-bridge.html
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
├── docs/
│   ├── previews/
│   │   ├── android-home-tv.png
│   │   ├── android-live-tv.png
│   │   ├── vod-traffic.png
│   │   ├── webplayer-live.png
│   │   ├── webplayer-login.png
│   │   └── webplayer-mobile.png
│   ├── admin-preview.png
│   ├── backend-boilerplate.md
│   ├── client-release-1.1.md
│   ├── ecosystem.md
│   ├── file-tree.md
│   ├── p2p-observability.md
│   ├── production.md
│   ├── seeds-production.md
│   ├── smart-tv-production.md
│   ├── validation.md
│   └── xui-hls-session-reuse.md
├── drizzle/
│   ├── meta/
│   │   ├── 0000_snapshot.json
│   │   ├── 0001_snapshot.json
│   │   ├── 0002_snapshot.json
│   │   ├── 0003_snapshot.json
│   │   └── _journal.json
│   ├── 0000_init.sql
│   ├── 0001_p2p_control_plane.sql
│   ├── 0002_admin_credentials.sql
│   └── 0003_xui_admin_credentials.sql
├── grafana/
│   └── provisioning/
│       ├── dashboards/
│       │   ├── dashboards.yml
│       │   └── fastify-p2p-dashboard.json
│       └── datasources/
│           └── datasource.yml
├── infra/
│   └── nginx/
│       ├── api.conf.template
│       ├── highpass-http.conf
│       └── highpass-proxy.conf
├── prometheus/
│   ├── blackbox.yml
│   ├── prometheus.prod.yml
│   └── prometheus.yml
├── public/
│   └── admin/
│       ├── admin.css
│       ├── admin.js
│       └── index.html
├── scripts/
│   ├── benchmark-http.mjs
│   ├── build-web.mjs
│   ├── collect-container-metrics.py
│   ├── deploy.sh
│   ├── highpass-switch
│   ├── observability.sh
│   ├── package-android-release.py
│   ├── package-tizen.py
│   ├── patch-p2p.mjs
│   ├── publish-clients.py
│   ├── setup-monitoring-host.sh
│   └── setup-turn.sh
├── src/
│   ├── config/
│   │   └── env.ts
│   ├── db/
│   │   ├── index.ts
│   │   ├── migrate.ts
│   │   └── schema.ts
│   ├── lib/
│   │   ├── errors.ts
│   │   ├── logger.ts
│   │   ├── metrics.ts
│   │   ├── password.ts
│   │   ├── redis.ts
│   │   ├── secrets.ts
│   │   └── xui-transport.ts
│   ├── modules/
│   │   ├── admin/
│   │   │   ├── admin-auth.service.ts
│   │   │   ├── admin.dto.ts
│   │   │   ├── admin.routes.ts
│   │   │   ├── admin.service.ts
│   │   │   ├── ui.ts
│   │   │   ├── xui-servers.controller.ts
│   │   │   └── xui-servers.service.ts
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.dto.ts
│   │   │   ├── auth.repository.ts
│   │   │   ├── auth.routes.ts
│   │   │   └── auth.service.ts
│   │   ├── health/
│   │   │   ├── health.controller.ts
│   │   │   ├── health.repository.ts
│   │   │   ├── health.routes.ts
│   │   │   └── health.service.ts
│   │   ├── iptv/
│   │   │   ├── iptv.dto.ts
│   │   │   ├── iptv.routes.ts
│   │   │   ├── iptv.service.ts
│   │   │   ├── origin-media.ts
│   │   │   ├── player-ui.ts
│   │   │   ├── roku-relay.ts
│   │   │   ├── seed-manager.ts
│   │   │   ├── telemetry.ts
│   │   │   ├── tracker.ts
│   │   │   └── vod-manager.ts
│   │   ├── notes/
│   │   │   ├── notes.controller.ts
│   │   │   ├── notes.dto.ts
│   │   │   ├── notes.repository.ts
│   │   │   ├── notes.routes.ts
│   │   │   └── notes.service.ts
│   │   └── realtime/
│   │       └── realtime.routes.ts
│   ├── services/
│   │   ├── peer-manager.ts
│   │   ├── xui-admin.client.ts
│   │   └── xui-auth.service.ts
│   ├── tests/
│   │   └── xui-integration.test.ts
│   ├── types/
│   │   └── fastify.d.ts
│   ├── ws/
│   │   └── peer.handler.ts
│   ├── app.ts
│   └── server.ts
├── tests/
│   ├── e2e/
│   │   ├── admin-navigation.ts
│   │   ├── android-fixture.ts
│   │   ├── container-seed.ts
│   │   ├── iptv-browser.ts
│   │   ├── native-vod-seek.ts
│   │   ├── seed-delivery.ts
│   │   └── vod-relay.ts
│   ├── helpers/
│   │   └── xui-fixture.ts
│   ├── integration/
│   │   ├── admin-login.test.ts
│   │   ├── api.test.ts
│   │   ├── artwork.test.ts
│   │   ├── hls-signatures.test.ts
│   │   ├── iptv.test.ts
│   │   ├── p2p.test.ts
│   │   ├── telemetry.test.ts
│   │   ├── xui-admin.test.ts
│   │   └── xui-transport.test.ts
│   ├── scripts/
│   │   └── test_publish_clients.py
│   └── unit/
│       ├── browser-seed.test.ts
│       ├── control-plane.test.ts
│       ├── delivery-policy.test.ts
│       ├── origin-media.test.ts
│       ├── resources.test.ts
│       ├── security.test.ts
│       ├── seed-lifecycle.test.ts
│       ├── seed-storage.test.ts
│       ├── telemetry-id.test.ts
│       ├── traffic.test.ts
│       └── xui-transport.test.ts
├── .dockerignore
├── .env.example
├── .env.production.example
├── .eslintrc
├── .gitignore
├── .nvmrc
├── Dockerfile
├── README.md
├── docker-compose.prod.yml
├── docker-compose.yml
├── drizzle.config.ts
├── ecosystem.config.cjs
├── eslint.config.js
├── package-lock.json
├── package.json
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

Builds, credenciais, node_modules, APKs e pacotes TV são artefatos ignorados pelo Git. As migrations SQL geradas ficam em drizzle/.
