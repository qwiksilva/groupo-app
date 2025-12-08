# GroupGram

A small Flask social app for creating groups, posting text with optional images/videos, and reacting with likes and comments. Authentication is handled with Flask-Login/Bcrypt and persistence via SQLAlchemy (SQLite by default, Postgres optional). Docker/Gunicorn are available for a production-style run.

## Prerequisites
- Python 3.11+
- pip
- Docker + Docker Compose (for the containerized run)

## Local Development (SQLite)
- Create and activate a virtualenv:
  - `python3 -m venv .venv`
  - `source .venv/bin/activate`
- Install dependencies: `pip install -r requirements.txt`
- Optional environment variables:
  - `SECRET_KEY` (defaults to `supersecretkey`)
  - `SQLALCHEMY_DATABASE_URI` (defaults to `sqlite:///groupo.db`)
  - `FLASK_ENV=development`
  - `UPLOAD_FOLDER` (defaults to `static/uploads`; the folder is created on start)
- Initialize/run the app (creates the SQLite DB if missing):
  - `flask --app app run --debug` **or** `python app.py`
- The site is served at http://localhost:5000.
- Utility scripts:
  - `python reset_db.py` drops/recreates the schema.
  - `python migration_reset.py` drops/recreates the schema and seeds users from `GROUPO_USER*` and `GROUPO_PASSWORD` environment variables.
  - `python dev_reset.py` drops/recreates the schema and seeds two demo users (`dev_alice` and `dev_bob`, both with password `password123`) for quick local testing.

## Mobile/API usage
- Auth:
  - `POST /api/register` with `username`, `password`, `first_name`, `last_name` → returns `{ token, user }`
  - `POST /api/login` with `username`, `password` → returns `{ token, user }` (send token as `Authorization: Bearer <token>` on subsequent requests)
- Groups/posts:
  - `GET /api/groups` → groups the user belongs to
  - `GET /api/groups/<id>/posts` → posts in the group
  - `POST /api/groups/<id>/posts` with `content` (and optional `file` uploads) → creates a post and triggers a notification stub
- Push token registration:
  - `POST /api/push/register` with `{ "token": "<push_token>", "platform": "ios" }` to store device tokens for notifications (integrate APNs/Expo in `notify_group_members`).

## Mobile push (Expo quick-start)
- Store Expo push tokens in your app (obtained from `expo-notifications`) and call `POST /api/push/register` with `Authorization: Bearer <token>` and body `{"token": "<expo-push-token>", "platform": "expo"}`.
- When a group member posts via the API, `notify_group_members` sends a push to all other members using the Expo push API (`EXPO_PUSH_URL` overrideable via env).
- For iOS soft launch:
  1. Reset DB locally to pick up new tables/columns: `python dev_reset.py` (or `python reset_db.py` if you prefer blank).
  2. Ship an Expo/React Native client to TestFlight; wire login/register to `/api/login`/`/api/register`, list `/api/groups`, fetch/post to `/api/groups/<id>/posts`, and register device tokens to `/api/push/register`.
  3. Iterate fast by pushing OTA updates via Expo/CodePush and watching server logs for `[notify]` lines to validate push delivery.

## File storage
- Local dev: uploads are stored under `static/uploads` (served from `/uploads/<filename>`).
- Render/production: if the `RENDER` env var is set to `true`, uploads are sent to S3 via `extensions/s3_upload.py`. Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, optional `AWS_REGION` (default `us-east-1`), and optional `S3_URL_EXPIRES` (seconds, default 86400). Objects are stored private and the app uses presigned URLs, so the bucket can stay non-public. Startup logs will show `[startup] RENDER=true...`; successful uploads log `[upload] S3 stored files: [...]`, failures log and fall back to local.
- To debug S3 locally: set `RENDER=true` and the AWS vars in your shell, run the app, and post a file. Watch console for `[upload]` logs; you should see the S3 URL or a fallback message.

## Production-Style Run (Docker)
- The Dockerfile runs `gunicorn app:app --bind 0.0.0.0:8000` inside the container.
- Build and start:
  - `docker-compose build`
  - `docker-compose up -d`
- App is available at http://localhost:8000.
- The Compose file starts a Postgres service, but the app defaults to SQLite. To use Postgres, set `SQLALCHEMY_DATABASE_URI=postgresql://groupgram:secret@db:5432/groupgram` on the `web` service (e.g., via `docker-compose.override.yml` or by editing `docker-compose.yml`).
- Logs/teardown:
  - `docker-compose logs -f web`
  - `docker-compose down`
- Note: The Dockerfile currently expects `seed_demo_data.py` and `static/demo_images`. Add these artifacts or update the Dockerfile before building.

## File Uploads and S3 (optional)
- Local uploads are saved to `static/uploads` and served via `/uploads/<filename>`.
- To switch to S3 uploads, uncomment `upload_file_to_s3` usage in `app.py` and set:
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
  - `S3_BUCKET_NAME`
  - `AWS_REGION` (optional, defaults to `us-east-1`)

## Tests
- Run all tests with `pytest`.
