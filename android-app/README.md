# Momentum PLM Android 客户端

该目录是原生 Android WebView 外壳；React/Vite 页面、脚本、样式和图标已随 APK 内置，不会从第三方站点下载应用界面。客户端通过 Bearer 会话调用服务端 API，原生模式只接受 HTTPS API 地址。

## 当前交付包

- 包名：`com.momentum.plm.test`
- 版本：`1.0.0-test`
- 最低 Android：API 23；目标 API：34；编译 API：35
- APK 使用 Android Debug 签名，仅用于测试和验收，不是应用商店发布签名
- APK 不内嵌生产 API 地址或凭据；首次启动时在登录页填写已部署服务的 HTTPS origin，客户端会将地址保存在本机。也可在构建时用 `VITE_API_BASE_URL` 预填可信 HTTPS origin；不设置时保持空白并由用户在登录页填写。

## 重新构建

先在项目根目录构建前端并复制到 Android assets。设置 `VITE_NATIVE_APP=true` 后，Vite 会自动将资源路径设为 WebView 可用的相对路径：

```bash
cd client
VITE_NATIVE_APP=true npm run build
cd ..
mkdir -p android-app/app/src/main/assets/www
cp -a client/dist/. android-app/app/src/main/assets/www/
```

如需预填 API origin，再设置 `VITE_API_BASE_URL=https://<你的HTTPS-API域名>` 后构建。确保已安装 Android SDK Platform 35、Build Tools 35.0.0 和 Java 17 或更新版本，并在 `android-app` 目录执行：

```bash
./gradlew assembleDebug
```

输出文件为 `android-app/app/build/outputs/apk/debug/app-debug.apk`。调试 APK 可直接安装；正式发布需要由发布方自行保管并配置 release keystore，不能复用调试签名。

## 集成边界

临时测试服务包含独立测试数据，不应作为生产数据库。Flowable、K3Cloud 和钉钉的真实连接需要在企业账套管理员设置中配置实际 HTTPS 地址、账号/应用密钥等凭证；服务端按账套加密保存，当前交付不会附带真实企业凭证。

Android 客户端 API 配置与请求头 mock 测试（使用本机 fetch stub，不连接服务端）：

```bash
npm test --prefix client
```
