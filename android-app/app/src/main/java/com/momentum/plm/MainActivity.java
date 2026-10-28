package com.momentum.plm;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 513;
    private static final String LOCAL_HOST = "localhost";
    private WebView webView;
    private ValueCallback<Uri[]> uploadCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(245, 246, 248));
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);

        webView.setBackgroundColor(Color.rgb(245, 246, 248));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equalsIgnoreCase(uri.getScheme()) || !LOCAL_HOST.equalsIgnoreCase(uri.getHost())) {
                    return null;
                }
                return serveAsset(uri.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equalsIgnoreCase(uri.getScheme()) && LOCAL_HOST.equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (ActivityNotFoundException ignored) {
                        // Block external navigation when no browser can handle it.
                    }
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (uploadCallback != null) uploadCallback.onReceiveValue(null);
                uploadCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException exception) {
                    uploadCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        setContentView(webView);
        if (savedInstanceState == null) {
            webView.loadUrl("https://localhost/");
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private WebResourceResponse serveAsset(String path) {
        String route = path == null || path.isEmpty() || "/".equals(path) ? "index.html" : path.substring(1);
        if (route.equals("api") || route.startsWith("api/")) {
            return response("application/json", 404, "Not Found", "{\"error\":\"api_base_url_required\"}");
        }
        if (!route.matches("[A-Za-z0-9._/-]+") || route.contains("..") || route.startsWith("/")) {
            return response("text/plain", 403, "Forbidden", "Forbidden");
        }
        try {
            InputStream stream;
            try {
                stream = getAssets().open("www/" + route);
            } catch (FileNotFoundException missingRoute) {
                // React client-side routes resolve to the bundled entry document.
                stream = getAssets().open("www/index.html");
                route = "index.html";
            }
            String mime = mimeType(route);
            String encoding = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") || mime.contains("xml")
                    ? "UTF-8" : null;
            return new WebResourceResponse(mime, encoding, stream);
        } catch (IOException exception) {
            return response("text/plain", 404, "Not Found", "Not Found");
        }
    }

    private String mimeType(String path) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(path);
        if (extension == null || extension.isEmpty()) return "application/octet-stream";
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase());
        if (mime != null) return mime;
        if ("js".equalsIgnoreCase(extension) || "mjs".equalsIgnoreCase(extension)) return "text/javascript";
        if ("svg".equalsIgnoreCase(extension)) return "image/svg+xml";
        if ("woff2".equalsIgnoreCase(extension)) return "font/woff2";
        return "application/octet-stream";
    }

    private WebResourceResponse response(String mime, int status, String reason, String body) {
        return new WebResourceResponse(mime, "UTF-8", status, reason,
                Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || uploadCallback == null) return;
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        uploadCallback.onReceiveValue(result);
        uploadCallback = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (uploadCallback != null) uploadCallback.onReceiveValue(null);
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
