# reset_db.py
from app import db, app
import os

with app.app_context():
    db.drop_all()
    db.create_all()
    print("Database reset complete.")