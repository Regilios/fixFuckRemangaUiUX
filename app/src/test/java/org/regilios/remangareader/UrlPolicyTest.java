package org.regilios.remangareader;

import org.junit.Test;
import static org.junit.Assert.*;

public class UrlPolicyTest {
    @Test public void acceptsOnlyExactHttpsOrigins() {
        assertTrue(UrlPolicy.isTrusted(UrlPolicy.FIRST_CHAPTER));
        assertTrue(UrlPolicy.isTrusted("https://www.remanga.org:443/"));
        assertFalse(UrlPolicy.isTrusted("https://remanga.org.evil.example/"));
        assertFalse(UrlPolicy.isTrusted("https://remanga.org@evil.example/"));
        assertFalse(UrlPolicy.isTrusted("https://person@remanga.org/"));
        assertFalse(UrlPolicy.isTrusted("https://remanga.org:444/"));
        assertFalse(UrlPolicy.isTrusted("http://remanga.org/"));
        assertFalse(UrlPolicy.isTrusted("javascript:alert(1)"));
        assertFalse(UrlPolicy.isTrusted("file:///etc/passwd"));
        assertFalse(UrlPolicy.isTrusted(null));
    }

    @Test public void separatesChaptersFromCatalogAndProfile() {
        assertTrue(UrlPolicy.isChapter(UrlPolicy.FIRST_CHAPTER));
        assertTrue(UrlPolicy.isChapter("https://remanga.org/manga/example/123/?page=2"));
        assertFalse(UrlPolicy.isChapter("https://remanga.org/manga/example/main"));
        assertFalse(UrlPolicy.isChapter("https://remanga.org/user/123/about"));
    }

    @Test public void extractsLinksFromChromeShareText() {
        assertEquals(UrlPolicy.FIRST_CHAPTER,
                UrlPolicy.fromSharedText("Глава 0\n" + UrlPolicy.FIRST_CHAPTER));
        assertEquals("https://remanga.org/manga/example/123",
                UrlPolicy.fromSharedText("Ссылка: https://remanga.org/manga/example/123."));
        assertNull(UrlPolicy.fromSharedText("https://remanga.org.evil.example/"));
        assertNull(UrlPolicy.fromSharedText(null));
    }
}
