import sqlite3
import json
from fastapi import FastAPI, HTTPException, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_PASSWORD = "supersecretpassword"  # Пароль редактора


# Инициализация БД SQLite
def init_db():
    conn = sqlite3.connect("ecotrail.db")
    cursor = conn.cursor()

    # Таблица троп
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS trails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        color TEXT DEFAULT '#1E88E5',
        coordinates TEXT NOT NULL -- Храним как JSON массив [[lat, lon], ...]
    )
    """)

    # Таблица растений/меток
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS plants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        photo_url TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        sightings INTEGER DEFAULT 0
    )
    """)

    # Таблица фиксации голосов пользователей (защита от повторных кликов)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sightings_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plant_id INTEGER,
        user_ip TEXT,
        UNIQUE(plant_id, user_ip)
    )
    """)

    conn.commit()
    conn.close()


init_db()


def get_db():
    conn = sqlite3.connect("ecotrail.db")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


# Модели данных
class TrailCreate(BaseModel):
    title: str
    color: str = "#1E88E5"
    coordinates: list[list[float]]  # [[lat, lon], [lat, lon]]


class PlantCreate(BaseModel):
    name: str
    description: str
    photo_url: str = ""
    lat: float
    lon: float


# Проверка пароля редактора
def verify_admin(x_admin_password: str = Header(None)):
    if x_admin_password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Неверный пароль редактора")


# --- ЭНДПОИНТЫ ---

# 1. Получить все данные для карты
@app.get("/api/data")
def get_map_data(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()

    cursor.execute("SELECT * FROM trails")
    raw_trails = cursor.fetchall()
    trails = []
    for t in raw_trails:
        trails.append({
            "id": t["id"],
            "title": t["title"],
            "color": t["color"],
            "coordinates": json.loads(t["coordinates"])
        })

    cursor.execute("SELECT * FROM plants")
    raw_plants = cursor.fetchall()
    plants = [dict(p) for p in raw_plants]

    return {"trails": trails, "plants": plants}


# 2. Добавить тропу (Только редактор)
@app.post("/api/trails", dependencies=[Depends(verify_admin)])
def create_trail(trail: TrailCreate, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO trails (title, color, coordinates) VALUES (?, ?, ?)",
        (trail.title, trail.color, json.dumps(trail.coordinates))
    )
    db.commit()
    return {"status": "ok", "id": cursor.lastrowid}


# 3. Добавить растение (Только редактор)
@app.post("/api/plants", dependencies=[Depends(verify_admin)])
def create_plant(plant: PlantCreate, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO plants (name, description, photo_url, lat, lon) VALUES (?, ?, ?, ?, ?)",
        (plant.name, plant.description, plant.photo_url, plant.lat, plant.lon)
    )
    db.commit()
    return {"status": "ok", "id": cursor.lastrowid}


# 4. Отметка "Я видел это растение"
@app.post("/api/plants/{plant_id}/sight")
def sight_plant(plant_id: int, request: Request, db: sqlite3.Connection = Depends(get_db)):
    client_ip = request.client.host
    cursor = db.cursor()

    try:
        cursor.execute(
            "INSERT INTO sightings_log (plant_id, user_ip) VALUES (?, ?)",
            (plant_id, client_ip)
        )
        cursor.execute(
            "UPDATE plants SET sightings = sightings + 1 WHERE id = ?",
            (plant_id,)
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Вы уже отмечали это растение")

    cursor.execute("SELECT sightings FROM plants WHERE id = ?", (plant_id,))
    updated_sightings = cursor.fetchone()["sightings"]

    return {"status": "ok", "sightings": updated_sightings}

# 5. Удаление растения (Только редактор)
@app.delete("/api/plants/{plant_id}", dependencies=[Depends(verify_admin)])
def delete_plant(plant_id: int, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("DELETE FROM plants WHERE id = ?", (plant_id,))
    cursor.execute("DELETE FROM sightings_log WHERE plant_id = ?", (plant_id,))
    db.commit()
    return {"status": "ok"}

# 6. Удаление тропы (Только редактор)
@app.delete("/api/trails/{trail_id}", dependencies=[Depends(verify_admin)])
def delete_trail(trail_id: int, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("DELETE FROM trails WHERE id = ?", (trail_id,))
    db.commit()
    return {"status": "ok"}

# Обслуживание статических файлов HTML
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)