"""
Reset the database for local development and seed two demo users.

Usage:
    python dev_reset.py
"""
from app import app, db, User, bcrypt, Group


def create_user(username: str, password: str, first_name: str, last_name: str) -> User:
    """Create a user with a hashed password."""
    hashed_pw = bcrypt.generate_password_hash(password).decode("utf-8")
    user = User(
        username=username,
        password=hashed_pw,
        first_name=first_name,
        last_name=last_name,
    )
    db.session.add(user)
    return user


def main():
    users = [
        {"username": "dev_alice", "password": "password123", "first_name": "Alice", "last_name": "Tester"},
        {"username": "dev_bob", "password": "password123", "first_name": "Bob", "last_name": "Builder"},
    ]

    with app.app_context():
        db.drop_all()
        db.create_all()

        created = [create_user(**u) for u in users]

        # Create a demo group and add both users.
        demo_group = Group(name="Demo Group")
        demo_group.members.extend(created)
        db.session.add(demo_group)
        db.session.commit()

        print("Database reset complete. Seeded users:")
        for u, raw in zip(created, users):
            print(f"- username: {u.username} / password: {raw['password']}")
        print("Added group: Demo Group (members: dev_alice, dev_bob)")


if __name__ == "__main__":
    main()
