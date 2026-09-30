package org.regilios.remangareader;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class UrlPolicy {
    static final String HOME = "https://remanga.org/";
    static final String FIRST_CHAPTER =
            "https://remanga.org/manga/rmknight-of-balance/2798517?page=1";
    private static final Pattern SHARED_LINK = Pattern.compile("https://[^\\s<>\"]+");
    private static final Pattern CHAPTER_PATH = Pattern.compile("/manga/[^/]+/\\d+/?");

    private UrlPolicy() {}

    static boolean isTrusted(String value) {
        if (value == null) {
            return false;
        }
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme())
                    && ("remanga.org".equalsIgnoreCase(host)
                        || "www.remanga.org".equalsIgnoreCase(host))
                    && uri.getRawUserInfo() == null
                    && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (URISyntaxException error) {
            return false;
        }
    }

    static boolean isChapter(String value) {
        return isTrusted(value) && CHAPTER_PATH.matcher(URI.create(value).getPath()).matches();
    }

    static String fromSharedText(String text) {
        if (text == null) {
            return null;
        }
        Matcher links = SHARED_LINK.matcher(text);
        while (links.find()) {
            String candidate = links.group().replaceAll("[).,;!]+$", "");
            if (isTrusted(candidate)) {
                return candidate;
            }
        }
        return null;
    }
}
