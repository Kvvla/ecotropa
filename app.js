import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore, collection, getDocs, addDoc, deleteDoc, doc, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 1. ВСТАВЬТЕ СВАИ ДАННЫЕ ИЗ FIREBASE КОНСОЛИ
const firebaseConfig = {

  apiKey: "AIzaSyCR1KKJIk0CRAZBWVZxA-juGZH79lBbH_E",

  authDomain: "ecotrail-project.firebaseapp.com",

  projectId: "ecotrail-project",

  storageBucket: "ecotrail-project.firebasestorage.app",

  messagingSenderId: "401282939426",

  appId: "1:401282939426:web:d907649e9d4206791c287b",

  measurementId: "G-E9HFETLRXG"

};


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Пароль редактора
const ADMIN_PASSWORD = "secretpassword"; // Поменяйте пароль здесь
let isAdminLoggedIn = false;
let myMap;

// Инициализация Яндекс Карты
ymaps.ready(initMap);

function initMap() {
    myMap = new ymaps.Map("map", {
        center: [55.7558, 37.6176],
        zoom: 12,
        controls: ['zoomControl', 'typeSelector', 'fullscreenControl']
    });

    loadData();
}

// Загрузка троп и меток из Firebase Firestore
async function loadData() {
    myMap.geoObjects.removeAll();

    try {
        // Загрузка троп
        const trailsSnapshot = await getDocs(collection(db, "trails"));
        trailsSnapshot.forEach(docSnap => {
            const trail = docSnap.data();
            const id = docSnap.id;

            let trailBalloonContent = `<div style="padding: 5px;"><b>${trail.title}</b>`;
            if (isAdminLoggedIn) {
                trailBalloonContent += `<button class="delete-btn" id="del-trail-${id}">Удалить тропу</button>`;
            }
            trailBalloonContent += `</div>`;

            const myPolyline = new ymaps.Polyline(
                trail.coordinates,
                { hintContent: trail.title, balloonContent: trailBalloonContent },
                { strokeColor: trail.color || "#1E88E5", strokeWidth: 5, strokeOpacity: 0.8 }
            );

            myMap.geoObjects.add(myPolyline);

            // Обработка клика по кнопке удаления внутри балуна
            myMap.geoObjects.events.add('click', () => {
                setTimeout(() => {
                    const btn = document.getElementById(`del-trail-${id}`);
                    if (btn) btn.onclick = () => deleteTrail(id);
                }, 100);
            });
        });

        // Загрузка растений
        const plantsSnapshot = await getDocs(collection(db, "plants"));
        plantsSnapshot.forEach(docSnap => {
            const plant = docSnap.data();
            const id = docSnap.id;

            let balloonContent = `
                <div class="plant-balloon">
                    ${plant.photo_url ? `<img src="${plant.photo_url}">` : ''}
                    <h4>${plant.name}</h4>
                    <p>${plant.description || ''}</p>
                    <button class="sight-btn" id="btn-plant-${id}">
                        Я видел это! (${plant.sightings || 0})
                    </button>
            `;

            if (isAdminLoggedIn) {
                balloonContent += `<button class="delete-btn" id="del-plant-${id}">Удалить метку</button>`;
            }
            balloonContent += `</div>`;

            const myPlacemark = new ymaps.Placemark(
                [plant.lat, plant.lon],
                { hintContent: plant.name, balloonContent: balloonContent },
                { preset: 'islands#greenLeafIcon' }
            );

            myMap.geoObjects.add(myPlacemark);

            // Слушатели событий клика внутри балуна
            myMap.geoObjects.events.add('click', () => {
                setTimeout(() => {
                    const sightBtn = document.getElementById(`btn-plant-${id}`);
                    if (sightBtn) sightBtn.onclick = () => sightPlant(id);

                    const delBtn = document.getElementById(`del-plant-${id}`);
                    if (delBtn) delBtn.onclick = () => deletePlant(id);
                }, 100);
            });
        });

    } catch (err) {
        console.error("Ошибка загрузки из Firebase:", err);
    }
}

// Отметка "Я видел это растение!"
async function sightPlant(id) {
    const btn = document.getElementById(`btn-plant-${id}`);
    try {
        const plantRef = doc(db, "plants", id);
        await updateDoc(plantRef, { sightings: increment(1) });
        btn.disabled = true;
        btn.innerText = "Отмечено!";
        loadData();
    } catch (e) {
        alert("Ошибка при сохранении отметки");
    }
}

// Добавление растения в Firebase
async function addPlant(e) {
    e.preventDefault();
    const name = document.getElementById('pName').value;
    const description = document.getElementById('pDesc').value;
    const photo_url = document.getElementById('pPhoto').value;
    const lat = parseFloat(document.getElementById('pLat').value);
    const lon = parseFloat(document.getElementById('pLon').value);

    try {
        await addDoc(collection(db, "plants"), {
            name, description, photo_url, lat, lon, sightings: 0
        });
        alert('Растение сохранено!');
        document.getElementById('plantForm').reset();
        loadData();
    } catch (err) {
        alert('Ошибка сохранения');
    }
}

// Добавление тропы в Firebase
// Надежное добавление тропы в Firebase
async function addTrail(e) {
    e.preventDefault();
    const title = document.getElementById('tTitle').value;
    const color = document.getElementById('tColor').value;
    const rawCoords = document.getElementById('tCoords').value;

    try {
        // Парсим координаты: разбиваем по semicolons, переходам строк и очищаем от пробелов
        const coordinates = rawCoords
            .split(';')
            .map(pair => pair.trim())
            .filter(pair => pair.length > 0) // Игнорируем пустые элементы
            .map(pair => {
                const parts = pair.split(',');
                if (parts.length !== 2) throw new Error("Неверная пара координат");

                const lat = parseFloat(parts[0].trim());
                const lon = parseFloat(parts[1].trim());

                if (isNaN(lat) || isNaN(lon)) throw new Error("Координата не является числом");
                return [lat, lon];
            });

        if (coordinates.length < 2) {
            alert('Тропа должна состоять минимум из 2 точек!');
            return;
        }

        await addDoc(collection(db, "trails"), { title, color, coordinates });
        alert('Тропа успешно сохранена!');
        document.getElementById('trailForm').reset();
        loadData();
    } catch (err) {
        alert('Ошибка в формате координат! Проверьте, что точки разделены точкой с запятой (;), а широта и долгота — запятой (,).');
    }
}

// Удаление растения
async function deletePlant(id) {
    if (!confirm("Удалить метку?")) return;
    await deleteDoc(doc(db, "plants", id));
    loadData();
}

// Удаление тропы
async function deleteTrail(id) {
    if (!confirm("Удалить тропу?")) return;
    await deleteDoc(doc(db, "trails", id));
    loadData();
}

// UI Логика
document.getElementById('adminToggleBtn').onclick = () => {
    const p = document.getElementById('adminPanel');
    p.style.display = p.style.display === 'block' ? 'none' : 'block';
};

document.getElementById('loginBtn').onclick = () => {
    const pass = document.getElementById('adminPass').value;
    if (pass === ADMIN_PASSWORD) {
        isAdminLoggedIn = true;
        document.getElementById('authBlock').style.display = 'none';
        document.getElementById('editorBlock').style.display = 'block';
        loadData();
    } else {
        alert('Неверный пароль!');
    }
};

document.getElementById('btnTabPlant').onclick = (e) => {
    e.target.classList.add('active');
    document.getElementById('btnTabTrail').classList.remove('active');
    document.getElementById('plantForm').style.display = 'block';
    document.getElementById('trailForm').style.display = 'none';
};

document.getElementById('btnTabTrail').onclick = (e) => {
    e.target.classList.add('active');
    document.getElementById('btnTabPlant').classList.remove('active');
    document.getElementById('plantForm').style.display = 'none';
    document.getElementById('trailForm').style.display = 'block';
};

document.getElementById('plantForm').onsubmit = addPlant;
document.getElementById('trailForm').onsubmit = addTrail;