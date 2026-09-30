package org.regilios.remangareader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.TextView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public final class ReaderNavigationTest {
    private static final String CHAPTER = "https://remanga.org/manga/example/123";
    private static final String PAGE = "<html><head><meta name='viewport' "
            + "content='width=device-width,initial-scale=1'><style>body{margin:0}"
            + ".fixed{position:fixed;left:0;right:0}.top-0{top:0}.bottom-0{bottom:0}"
            + ".flex-nowrap{display:flex}button{width:40px;height:40px}main{height:6000px}"
            + "</style></head><body><div class='fresnel-container fresnel-lessThan-md'>"
            + "<div class='fixed top-0'><button>Top</button></div>"
            + "<div class='fixed bottom-0'><div class='no-wrap'><div class='flex flex-nowrap'>"
            + "<button>Bottom</button></div></div></div></div><main>Reader test</main></body></html>";

    @Test
    public void navigationAndProgressKeepTheirSpaceUntilFullscreen() throws Exception {
        AtomicReference<WebView> page = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                WebView web = findWebView(activity.getWindow().getDecorView());
                page.set(web);
                web.stopLoading();
                web.loadDataWithBaseURL(CHAPTER, PAGE, "text/html", "UTF-8", CHAPTER);
            });
            WebView web = page.get();
            waitFor(web, "Boolean(document.querySelector('#rfx-fullscreen'))");
            waitFor(web, "typeof window.RemangaNative?.postMessage === 'function'");
            scenario.onActivity(activity -> {
                assertEquals("The fixture must have a trusted chapter URL", CHAPTER, web.getUrl());
                assertTrue(findText(activity.getWindow().getDecorView(), "Chrome").isShown());
            });

            javascript(web, "window.scrollTo(0,600);true");
            waitFor(web, "window.scrollY === 600");
            AtomicReference<Integer> height = new AtomicReference<>();
            scenario.onActivity(activity -> height.set(web.getHeight()));
            for (int progress : new int[]{10, 35, 95, 100}) {
                scenario.onActivity(activity -> web.getWebChromeClient().onProgressChanged(web, progress));
                InstrumentationRegistry.getInstrumentation().waitForIdleSync();
                scenario.onActivity(activity -> assertEquals(height.get().intValue(), web.getHeight()));
                assertEquals("600", javascript(web, "window.scrollY"));
            }

            // A direct call uses the same trusted WebView message bridge as the page button.
            javascript(web, "window.RemangaNative.postMessage(JSON.stringify({type:'toggleFullscreen'}));true");
            waitFor(web, "document.querySelector('#rfx-fullscreen').getAttribute('aria-pressed') === 'true'");
            scenario.onActivity(activity -> {
                assertTrue(!findText(activity.getWindow().getDecorView(), "Chrome").isShown());
                assertTrue(web.getHeight() > height.get());
                activity.getOnBackPressedDispatcher().onBackPressed();
            });
            waitFor(web, "document.querySelector('#rfx-fullscreen').getAttribute('aria-pressed') === 'false'");
            scenario.onActivity(activity -> assertTrue(findText(activity.getWindow().getDecorView(), "Chrome").isShown()));
        }
    }

    private static String javascript(WebView web, String source) throws Exception {
        CountDownLatch ready = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> web.evaluateJavascript(source, value -> {
            result.set(value);
            ready.countDown();
        }));
        assertTrue("WebView JavaScript timed out", ready.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private static void waitFor(WebView web, String condition) throws Exception {
        long deadline = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(javascript(web, condition))) return;
            Thread.sleep(100);
        }
        assertEquals(condition, "true", javascript(web, condition));
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                WebView match = findWebView(group.getChildAt(index));
                if (match != null) return match;
            }
        }
        return null;
    }

    private static TextView findText(View view, String text) {
        if (view instanceof TextView && text.contentEquals(((TextView) view).getText())) return (TextView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int index = 0; index < group.getChildCount(); index++) {
                TextView match = findText(group.getChildAt(index), text);
                if (match != null) return match;
            }
        }
        return null;
    }
}
