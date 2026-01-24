#!/usr/bin/env python3
import argparse
import os
from urllib.parse import urlparse, unquote

from app import app, db, Post


def is_http_url(value: str) -> bool:
    return value.startswith("http://") or value.startswith("https://")


def extract_key(url: str, bucket: str) -> str | None:
    parsed = urlparse(url)
    host = parsed.netloc
    path = parsed.path.lstrip("/")
    if not host or not path:
        return None

    if bucket and host.startswith(f"{bucket}."):
        return unquote(path)

    if host.startswith("s3.") or host.startswith("s3-") or host.startswith("s3."):
        if bucket and path.startswith(f"{bucket}/"):
            return unquote(path[len(bucket) + 1 :])

    if ".s3." in host and bucket and host.startswith(f"{bucket}."):
        return unquote(path)

    return None


def normalize_image_urls(image_urls: str, bucket: str) -> tuple[str, int]:
    if not image_urls:
        return image_urls, 0
    parts = [p.strip() for p in image_urls.split(",") if p.strip()]
    changed = 0
    updated = []
    for part in parts:
        if is_http_url(part):
            key = extract_key(part, bucket)
            if key:
                updated.append(key)
                changed += 1
            else:
                updated.append(part)
        else:
            updated.append(part)
    return ",".join(updated), changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill S3 presigned URLs to keys in Post.image_urls.")
    parser.add_argument("--apply", action="store_true", help="Write changes to the database.")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of posts to process (0 = no limit).")
    parser.add_argument("--bucket", default=None, help="S3 bucket name (defaults to env S3_BUCKET_NAME).")
    args = parser.parse_args()

    bucket = args.bucket or os.environ.get("S3_BUCKET_NAME")

    with app.app_context():
        query = Post.query.order_by(Post.id.asc())
        if args.limit:
            query = query.limit(args.limit)
        posts = query.all()

        total = 0
        changed_rows = 0
        changed_urls = 0
        for post in posts:
            total += 1
            new_urls, changed = normalize_image_urls(post.image_urls or "", bucket or "")
            if changed:
                changed_rows += 1
                changed_urls += changed
                if args.apply:
                    post.image_urls = new_urls

        if args.apply and changed_rows:
            db.session.commit()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(
        f"[{mode}] posts={total} rows_changed={changed_rows} urls_converted={changed_urls}"
    )
    if not args.apply:
        print("Run with --apply to persist changes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
