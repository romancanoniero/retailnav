# RetailNav App Clip

The iOS project uses XcodeGen. The QR/universal link opens Apple's App Clip card; iOS requires the visitor to tap **Open** on that card. The Clip then asks for one name and loads RetailNav inside `WKWebView`, without Safari's address or bottom bars. The existing HTTPS web app remains the cross-platform fallback.

## Apple setup needed before public QR activation

The Xcode targets use proposed bundle IDs `com.improvingyourreality.retailnav` and `com.improvingyourreality.retailnav.clip`; verify/register them in the Apple Developer account before signing. The Clip target uses the parent app ID entitlement and the `appclips:improvingyourreality.com` associated domain.

The domain owner must merge both app IDs into the existing root-level `/.well-known/apple-app-site-association` file and serve it over HTTPS without redirect. This file is at the domain root, outside the isolated `/retailnav/` Contabo deployment, so this repository deliberately does not overwrite it. Then register the Clip experience and QR in App Store Connect and submit the containing app/Clip for Apple review. The QR invocation URL should be `https://improvingyourreality.com/retailnav/?mall=aventura`.

The Clip accepts only HTTPS invocations on the RetailNav host and path, and only mall IDs currently present in the catalog. The visitor's name is sent to the existing anonymous `/api/me` endpoint using a WebKit event, never a URL parameter.
