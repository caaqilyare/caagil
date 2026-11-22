export type RuntimePreset = {
  id: string;
  label: string;
  group: "php" | "node" | "static" | "cms" | "custom";
  image: string;
  port: number;
  command?: string;
  /** Mount the cloned repository into this path. */
  mountPath?: string;
  /** Document root inside the container (PHP only, informational). */
  docRoot?: string;
  description: string;
  env?: Record<string, string>;
};

export const PRESETS: RuntimePreset[] = [
  {
    id: "php84",
    label: "PHP 8.4 · Apache",
    group: "php",
    image: "php:8.4-apache",
    port: 80,
    mountPath: "/var/www/html",
    docRoot: "/var/www/html",
    description: "Apache + mod_php. Good for classic PHP sites and small frameworks.",
  },
  {
    id: "php83",
    label: "PHP 8.3 · Apache",
    group: "php",
    image: "php:8.3-apache",
    port: 80,
    mountPath: "/var/www/html",
    docRoot: "/var/www/html",
    description: "Stable PHP 8.3 stack for production sites.",
  },
  {
    id: "php82",
    label: "PHP 8.2 · Apache",
    group: "php",
    image: "php:8.2-apache",
    port: 80,
    mountPath: "/var/www/html",
    docRoot: "/var/www/html",
    description: "Legacy-friendly PHP 8.2 stack.",
  },
  {
    id: "laravel",
    label: "Laravel (PHP 8.4)",
    group: "php",
    image: "php:8.4-apache",
    port: 80,
    mountPath: "/var/www/html",
    docRoot: "/var/www/html/public",
    command:
      "a2enmod rewrite >/dev/null 2>&1; sed -i 's#</VirtualHost>#  <Directory /var/www/html/public>\\n    AllowOverride All\\n    Require all granted\\n  </Directory>\\n  DocumentRoot /var/www/html/public\\n</VirtualHost>#' /etc/apache2/sites-available/000-default.conf; apache2-foreground",
    description: "Apache with the document root pointed at /public.",
  },
  {
    id: "wordpress",
    label: "WordPress",
    group: "cms",
    image: "wordpress:php8.3-apache",
    port: 80,
    mountPath: "/var/www/html",
    description: "Official WordPress image. Set WORDPRESS_DB_* env vars to your MySQL service.",
  },
  {
    id: "node22",
    label: "Node.js 22",
    group: "node",
    image: "node:22-alpine",
    port: 3000,
    mountPath: "/app",
    command: "cd /app && (npm ci --omit=dev || npm install --omit=dev) && npm start",
    description: "Runs `npm start` from the cloned repository on port 3000.",
  },
  {
    id: "node20",
    label: "Node.js 20",
    group: "node",
    image: "node:20-alpine",
    port: 3000,
    mountPath: "/app",
    command: "cd /app && (npm ci --omit=dev || npm install --omit=dev) && npm start",
    description: "Same as Node 22 but on the 20 LTS runtime.",
  },
  {
    id: "static",
    label: "Static site · Nginx",
    group: "static",
    image: "nginx:alpine",
    port: 80,
    mountPath: "/usr/share/nginx/html",
    description: "Serves the repository contents as static files.",
  },
  {
    id: "custom",
    label: "Custom Docker image",
    group: "custom",
    image: "",
    port: 80,
    description: "Bring any image. You control the port, command and volumes.",
  },
];

export function findPreset(id: string): RuntimePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export type DbEngine = {
  id: "mysql" | "mariadb" | "postgres" | "mongo" | "redis";
  label: string;
  versions: string[];
  port: number;
  dataPath: string;
  description: string;
};

export const ENGINES: DbEngine[] = [
  {
    id: "mysql",
    label: "MySQL",
    versions: ["8.4", "8.0", "5.7"],
    port: 3306,
    dataPath: "/var/lib/mysql",
    description: "The default choice. Remote access supported with per-database users.",
  },
  {
    id: "mariadb",
    label: "MariaDB",
    versions: ["11", "10.11"],
    port: 3306,
    dataPath: "/var/lib/mysql",
    description: "MySQL-compatible, lighter memory footprint.",
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    versions: ["17", "16", "15"],
    port: 5432,
    dataPath: "/var/lib/postgresql/data",
    description: "Great for Laravel, Rails, Django and analytics.",
  },
  {
    id: "mongo",
    label: "MongoDB",
    versions: ["7", "6"],
    port: 27017,
    dataPath: "/data/db",
    description: "Document database with root credentials.",
  },
  {
    id: "redis",
    label: "Redis",
    versions: ["7"],
    port: 6379,
    dataPath: "/data",
    description: "Cache and queues, password protected.",
  },
];
