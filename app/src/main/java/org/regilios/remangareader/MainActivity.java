package org.regilios.remangareader;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;

public final class MainActivity extends Activity {
    private WebView webView;
    private LinearLayout root;
    private LinearLayout toolbar;
    private LinearLayout errorPanel;
    private ProgressBar progress;
    private TextView errorText;
    private SharedPreferences preferences;
    private String readerScript;
    private String currentUrl = UrlPolicy.FIRST_CHAPTER;
    private boolean fullscreen;

    @Override
    public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        preferences = getSharedPreferences("reader", MODE_PRIVATE);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        try (InputStream source = getAssets().open("reader.js")) {
            ByteArrayOutputStream content = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = source.read(buffer)) != -1) {
                content.write(buffer, 0, count);
            }
            readerScript = content.toString(StandardCharsets.UTF_8.name());
        } catch (IOException error) {
            throw new IllegalStateException("Cannot load the bundled reader script", error);
        }
        createLayout();
        configureWebView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        String requestedUrl = urlFromIntent(getIntent());
        String savedUrl = preferences.getString("last_url", UrlPolicy.FIRST_CHAPTER);
        currentUrl = requestedUrl != null ? requestedUrl : savedUrl;
        if (!UrlPolicy.isTrusted(currentUrl)) {
            currentUrl = UrlPolicy.FIRST_CHAPTER;
        }
        if (savedState != null) {
            fullscreen = savedState.getBoolean("fullscreen");
            currentUrl = savedState.getString("current_url", currentUrl);
        }
        updateReaderUi(currentUrl);
        if (savedState == null || webView.restoreState(savedState) == null) {
            webView.loadUrl(currentUrl);
        }
        applyFullscreen();
    }

    private void createLayout() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(17, 17, 21));

        toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.addView(button("Главная", () -> webView.loadUrl(UrlPolicy.HOME)));
        toolbar.addView(button("Ссылка", this::askForLink));
        toolbar.addView(button("Обновить", () -> webView.reload()));
        root.addView(toolbar);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));

        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setPadding(dp(16), dp(16), dp(16), dp(16));
        errorText = new TextView(this);
        errorText.setTextColor(Color.WHITE);
        errorPanel.addView(errorText);
        errorPanel.addView(button("Повторить", () -> webView.loadUrl(currentUrl)));
        errorPanel.addView(button("Открыть в Chrome", () -> openExternal(Uri.parse(currentUrl))));
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(17, 17, 21));
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets cutout = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());
            Insets bars = fullscreen ? Insets.NONE
                    : windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(Math.max(bars.left, cutout.left),
                    Math.max(bars.top, cutout.top), Math.max(bars.right, cutout.right),
                    Math.max(Math.max(bars.bottom, cutout.bottom), keyboard.bottom));
            // The native layout already keeps controls clear of system bars and cutouts.
            return WindowInsetsCompat.CONSUMED;
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "RemangaNative",
                    new HashSet<>(Arrays.asList("https://remanga.org", "https://www.remanga.org")),
                    (view, message, origin, isMainFrame, reply) -> {
                        if (!isMainFrame || !UrlPolicy.isTrusted(origin.toString())
                                || !UrlPolicy.isTrusted(view.getUrl())) {
                            return;
                        }
                        try {
                            String type = new JSONObject(message.getData()).optString("type");
                            if ("toggleFullscreen".equals(type) && UrlPolicy.isChapter(view.getUrl())) {
                                fullscreen = !fullscreen;
                                applyFullscreen();
                            }
                            if ("ready".equals(type) || "toggleFullscreen".equals(type)) {
                                reply.postMessage("{\"fullscreen\":" + fullscreen + "}");
                            }
                        } catch (JSONException | NullPointerException ignored) {
                            // Ignore messages that are not part of the small reader protocol.
                        }
                    });
        } else {
            new AlertDialog.Builder(this).setTitle("Обновите Android System WebView")
                    .setMessage("Для кнопки полного экрана нужен свежий Android System WebView. "
                            + "Обновите его в Google Play и перезапустите приложение.")
                    .setPositiveButton("Понятно", null).show();
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                progress.setVisibility(value == 100 || fullscreen ? View.GONE : View.VISIBLE);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) {
                    return false;
                }
                if (UrlPolicy.isTrusted(request.getUrl().toString())) {
                    return false;
                }
                if (request.hasGesture()) {
                    openExternal(request.getUrl());
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (!UrlPolicy.isTrusted(url)) {
                    view.stopLoading();
                    return;
                }
                currentUrl = url;
                errorPanel.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
                updateReaderUi(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                injectReader(url);
                CookieManager.getInstance().flush();
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                if (UrlPolicy.isTrusted(url)) {
                    currentUrl = url;
                    preferences.edit().putString("last_url", url).apply();
                    updateReaderUi(url);
                    injectReader(url);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showLoadError("Не удалось загрузить Remanga. Проверьте подключение к интернету.");
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    showLoadError("Remanga вернула ошибку " + response.getStatusCode()
                            + ". Можно повторить запрос или открыть страницу в браузере.");
                }
            }
        });
    }

    private void injectReader(String url) {
        if (UrlPolicy.isTrusted(url)) {
            webView.evaluateJavascript(readerScript, ignored -> syncFullscreen());
        }
    }

    private void updateReaderUi(String url) {
        boolean reading = UrlPolicy.isChapter(url);
        toolbar.setVisibility(reading ? View.GONE : View.VISIBLE);
        if (!reading && fullscreen) {
            fullscreen = false;
            applyFullscreen();
        }
    }

    private void applyFullscreen() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), root);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (fullscreen) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            progress.setVisibility(View.GONE);
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
        ViewCompat.requestApplyInsets(root);
        syncFullscreen();
    }

    private void syncFullscreen() {
        if (webView != null && UrlPolicy.isTrusted(webView.getUrl())) {
            webView.evaluateJavascript("window.RemangaReaderFix?.setFullscreen(" + fullscreen + ")", null);
        }
    }

    private void showLoadError(String message) {
        errorText.setText(message);
        errorPanel.setVisibility(View.VISIBLE);
        progress.setVisibility(View.GONE);
    }

    private Button button(String label, Runnable action) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setOnClickListener(view -> action.run());
        return button;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void askForLink() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("https://remanga.org/…");
        new AlertDialog.Builder(this).setTitle("Открыть ссылку Remanga").setView(input)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Открыть", (dialog, which) -> {
                    String url = UrlPolicy.fromSharedText(input.getText().toString());
                    if (url != null) {
                        webView.loadUrl(url);
                    } else {
                        Toast.makeText(this, "Нужна ссылка https://remanga.org/…", Toast.LENGTH_LONG).show();
                    }
                }).show();
    }

    private String urlFromIntent(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            return UrlPolicy.fromSharedText(intent.getStringExtra(Intent.EXTRA_TEXT));
        }
        String url = intent.getDataString();
        return UrlPolicy.isTrusted(url) ? url : null;
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) {
            Toast.makeText(this, "Эта ссылка не поддерживается", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        // Chrome is preferred so Remanga links do not reopen this same activity.
        intent.setPackage("com.android.chrome");
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException error) {
            intent.setPackage(null);
            startActivity(Intent.createChooser(intent, "Открыть в браузере"));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = urlFromIntent(intent);
        if (url != null) {
            webView.loadUrl(url);
        } else {
            Toast.makeText(this, "Поделитесь ссылкой с remanga.org", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (fullscreen) {
            fullscreen = false;
            applyFullscreen();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            finish();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && root != null) {
            applyFullscreen();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        state.putBoolean("fullscreen", fullscreen);
        state.putString("current_url", currentUrl);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        root.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
