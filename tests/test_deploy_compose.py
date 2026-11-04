"""Compose invariants for the yunrong.ink ECS (Nginx Proxy Manager already owns 80/443)."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPOSE = (ROOT / "deploy" / "docker-compose.yml").read_text()
NGINX = (ROOT / "deploy" / "nginx" / "yunrong.ink.conf").read_text()
ENV = (ROOT / "deploy" / ".env.example").read_text()


class DeployComposeTests(unittest.TestCase):
    def test_default_stack_does_not_publish_host_http(self):
        self.assertIn("profiles: [bundled-nginx]", COMPOSE)
        self.assertEqual(COMPOSE.count("80:80"), 1)
        self.assertEqual(COMPOSE.count("443:443"), 1)
        self.assertGreater(COMPOSE.index("80:80"), COMPOSE.index("profiles: [bundled-nginx]"))
        self.assertNotIn("ports:", COMPOSE.split("nginx:")[0])

    def test_joins_configurable_npm_network(self):
        self.assertIn("nginx-proxy-manage_default", COMPOSE)
        self.assertIn("FIN_PROXY_NETWORK", COMPOSE)
        self.assertIn("external: true", COMPOSE)
        self.assertIn("FIN_PROXY_NETWORK=nginx-proxy-manage_default", ENV)

    def test_scheme_a_api_and_web(self):
        self.assertIn("/var/lib/yixing-finance/finance:/data/finance", COMPOSE)
        self.assertIn('FIN_REQUIRE_TOKEN: "1"', COMPOSE)
        self.assertIn("FIN_DATA_DIR: /data/finance", COMPOSE)
        self.assertIn('expose: ["8787"]', COMPOSE)
        self.assertIn("FINANCE_API_INTERNAL_BASE: http://api:8787/api/v1", COMPOSE)
        self.assertIn("NEXT_PUBLIC_FINANCE_API_BASE: /api/v1", COMPOSE)
        self.assertIn("aliases: [web]", COMPOSE)
        self.assertIn("aliases: [api]", COMPOSE)
        self.assertNotIn("NEXT_PUBLIC_FIN_API_TOKEN=", ENV)
        self.assertIn("FORBIDDEN: NEXT_PUBLIC_FIN_API_TOKEN", ENV)

    def test_bundled_nginx_does_not_proxy_api(self):
        self.assertIn("proxy_pass http://web:3000", NGINX)
        self.assertNotIn("8787", NGINX)
        self.assertNotRegex(NGINX, r"location\s+/api")


if __name__ == "__main__":
    unittest.main()
