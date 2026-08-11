import os
import sys
import asyncio
from sqlalchemy.orm import Session

# Add the parent directory to sys.path so we can import 'app'
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.db.session import SessionLocal
from app import models
from fastapi.testclient import TestClient
from app.main import app
from app.api import deps

# Setup mock user and db
def override_get_db():
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()

def get_test_user(db: Session):
    user = db.query(models.User).filter(models.User.email == "test_ml@example.com").first()
    if not user:
        user = models.User(email="test_ml@example.com", full_name="Test ML", hashed_password="fake", is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user

db = SessionLocal()
test_user = get_test_user(db)
db.close()

def override_get_current_user():
    return test_user

app.dependency_overrides[deps.get_db] = override_get_db
app.dependency_overrides[deps.get_current_user] = override_get_current_user

client = TestClient(app)

def test_ml_registry():
    print("--- Starting ML Registry Verification ---")
    
    # 1. Get Models (should be empty or list)
    print("\n1. Fetching models...")
    response = client.get("/api/v1/ml-models/")
    print(f"Status: {response.status_code}")
    assert response.status_code == 200
    print(f"Initial models count: len({len(response.json())})")

    # 2. Create a new model
    print("\n2. Creating a new model...")
    # Create a dummy file
    with open("dummy.pkl", "wb") as f:
        f.write(b"dummy data")
        
    with open("dummy.pkl", "rb") as f:
        response = client.post(
            "/api/v1/ml-models/",
            data={
                "name": "Test Alpha",
                "model_type": "LSTM",
                "version": 1.0,
                "description": "Initial test version"
            },
            files={"file": ("dummy.pkl", f, "application/octet-stream")}
        )
    print(f"Status: {response.status_code}")
    assert response.status_code == 200
    model_data = response.json()
    model_id = model_data["id"]
    version_id = model_data["active_version_id"]
    print(f"Created Model ID: {model_id}, Active Version: {version_id}")
    
    # Check if the file is actually saved on disk
    upload_path = os.path.join("uploads", "models", f"{version_id}_dummy.pkl")
    print(f"Checking if file exists at {upload_path}: {os.path.exists(upload_path)}")
    assert os.path.exists(upload_path)

    # 3. Upload a new version
    print("\n3. Uploading a new version...")
    with open("dummy.pkl", "rb") as f:
        response = client.post(
            f"/api/v1/ml-models/{model_id}/versions",
            data={
                "version": 1.1,
                "description": "Second test version"
            },
            files={"file": ("dummy.pkl", f, "application/octet-stream")}
        )
    print(f"Status: {response.status_code}")
    assert response.status_code == 200
    model_data = response.json()
    new_version_id = [v for v in model_data["versions"] if v["version"] == 1.1][0]["id"]
    print(f"Uploaded new Version ID: {new_version_id}")

    # 4. Set active version
    print("\n4. Changing active version...")
    # Wait to allow background task to process (change status to Ready)
    # Background tasks are not actually awaited in TestClient, so we might need to manually set status to Ready for testing
    print("Manually setting status to Ready for testing...")
    db = SessionLocal()
    ver = db.query(models.ModelVersion).filter(models.ModelVersion.id == new_version_id).first()
    ver.status = models.ModelStatus.READY
    db.commit()
    db.close()
    
    response = client.put(
        f"/api/v1/ml-models/{model_id}/active-version",
        json={"active_version_id": new_version_id}
    )
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print(f"Success! Active version is now {response.json()['active_version_id']}")
    else:
        print(f"Failed to set active version: {response.json()}")
        
    # 5. Delete model
    print("\n5. Deleting model...")
    response = client.delete(f"/api/v1/ml-models/{model_id}")
    print(f"Status: {response.status_code}")
    assert response.status_code == 200
    print("Model deleted successfully.")
    
    # Check if file is removed
    print(f"Checking if file was deleted at {upload_path}: {not os.path.exists(upload_path)}")
    
    # Clean up dummy file
    os.remove("dummy.pkl")
    print("\n--- ML Registry Verification Complete ---")

if __name__ == "__main__":
    test_ml_registry()
