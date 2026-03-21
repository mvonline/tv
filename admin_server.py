import json
import os
import sys
import base64
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8001
CREDENTIALS_FILE = "credentials.txt"
CHANNELS_FILE = "channels.json"

class AdminHandler(SimpleHTTPRequestHandler):
    def check_auth(self):
        auth_header = self.headers.get("Authorization")
        if auth_header and auth_header.startswith("Basic "):
            encoded = auth_header.split(" ")[1]
            try:
                decoded = base64.b64decode(encoded).decode("utf-8")
                
                # Check Environment Variable first (For Cloud Hosting securely)
                env_creds = os.environ.get("ADMIN_CREDENTIALS")
                if env_creds and decoded == env_creds:
                    return True
                
                # Read valid credentials dynamically from file
                valid_creds = []
                if os.path.exists(CREDENTIALS_FILE):
                    with open(CREDENTIALS_FILE, "r") as f:
                        valid_creds = [line.strip() for line in f if line.strip() and not line.startswith("#")]
                
                if decoded in valid_creds:
                    return True
            except Exception as e:
                print(f"Auth error: {e}")
        
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="MasTV Admin Panel"')
        self.send_header("Content-type", "text/html")
        self.end_headers()
        self.wfile.write(b"Unauthorized Access")
        return False

    def do_GET(self):
        # Enforce basic auth on ALL requests to this server port
        if not self.check_auth():
            return

        # Redirect root to the admin SPA
        if self.path == "/" or self.path == "/admin":
            self.send_response(301)
            self.send_header('Location', '/admin/')
            self.end_headers()
            return
            
        # Optional: default trailing slash to index.html
        if self.path == "/admin/":
            self.path = "/admin/index.html"
            
        return super().do_GET()

    def do_POST(self):
        if not self.check_auth():
            return
            
        if self.path == "/api/update_channel":
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                return
                
            post_data = self.rfile.read(content_length)
            
            try:
                payload = json.loads(post_data)
                ch_id = payload.get("id")
                
                if not ch_id:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'{"error": "Missing channel ID"}')
                    return
                
                # Load channels.json
                if not os.path.exists(CHANNELS_FILE):
                    self.send_response(500)
                    self.end_headers()
                    self.wfile.write(b'{"error": "channels.json not found"}')
                    return
                    
                with open(CHANNELS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    
                updated = False
                for ch in data.get("channels", []):
                    if ch["id"] == ch_id:
                        if "name" in payload: ch["name"] = payload["name"]
                        if "category" in payload: ch["category"] = payload["category"]
                        if "logo_url" in payload: ch["logo_url"] = payload["logo_url"]
                        updated = True
                        break
                        
                if updated:
                    # Securely save back to JSON
                    with open(CHANNELS_FILE, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2, ensure_ascii=False)
                        
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(b'{"status": "success"}')
                else:
                    self.send_response(404)
                    self.end_headers()
                    self.wfile.write(b'{"error": "Channel ID not found"}')
                    
            except Exception as e:
                print(f"Error handling POST: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(f'{{"error": "{str(e)}" }}'.encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Only generate the default local file if there are no secure cloud environment variables set
    if not os.path.exists(CREDENTIALS_FILE) and not os.environ.get("ADMIN_CREDENTIALS"):
        with open(CREDENTIALS_FILE, "w") as f:
            f.write("admin:password123\n")
        print(f"[*] Created {CREDENTIALS_FILE} with default: admin:password123")
        
    try:
        server = HTTPServer(("0.0.0.0", PORT), AdminHandler)
        print(f"\n[+] MasTV Admin Server started securely on http://localhost:{PORT}/admin")
        print("[!] Close this window or press Ctrl+C to stop the admin panel.\n")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAdmin Server stopped.")
        sys.exit(0)
