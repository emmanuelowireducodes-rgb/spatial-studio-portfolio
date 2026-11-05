# Testing phone motion controls

Device orientation access requires a secure context. For the most reliable test, deploy a preview build to an HTTPS host such as the project's HTTPS preview deployment, then open that exact HTTPS URL on the phone being tested. Opening `localhost` on the development computer does not grant sensor access to a phone, and a plain HTTP LAN address is not a secure context.

For local network testing, configure Vite with a certificate trusted by the phone and containing the development machine's LAN IP in its subject alternative names. An untrusted or mismatched self-signed certificate may still be treated as insecure by the browser.

On the phone, enter **360° View**, tap **Motion**, and grant the browser's motion permission if prompted. Use **Recenter** while holding the phone in the direction that should become the current view. **Touch** returns to drag control; **Exit 360°** returns to the selected gallery wall. If the browser reports that no sensor readings arrived, touch navigation remains available.

Test on physical Android Chrome and iPhone Safari in portrait and landscape. Browser emulation and desktop localhost do not verify physical sensor behavior or platform permission prompts.
