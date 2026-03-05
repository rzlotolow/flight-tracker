import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore, collection, addDoc, query, where, getDocs, updateDoc, doc, orderBy } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const firebaseConfig = {
   apiKey: "AIzaSyAhov2iADGzgg3yKkVyJLB2DpJCMFRLjU0",
   authDomain: "flight-tracker-1ee6c.firebaseapp.com",
   projectId: "flight-tracker-1ee6c",
   storageBucket: "flight-tracker-1ee6c.firebasestorage.app",
   messagingSenderId: "411596757145",
   appId: "1:411596757145:web:4eb45f2a1f365108c9c008"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let allFlights = [];
let airportData = [];

const AIRPORTS_URL = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

async function loadAirportData() {
   try {
       const response = await fetch(AIRPORTS_URL);
       const data = await response.json();
       airportData = Object.entries(data).map(([code, info]) => ({
           code: code,
           name: info.name,
           city: info.city,
           country: info.country,
           lat: info.lat,
           lon: info.lon
       }));
   } catch (error) {
       console.error('Error loading airport data:', error);
   }
}

function searchAirports(searchTerm) {
   const term = searchTerm.toUpperCase();
   return airportData.filter(airport => 
       airport.code.includes(term) || 
       airport.name.toUpperCase().includes(term) ||
       airport.city.toUpperCase().includes(term)
   ).slice(0, 10);
}

function setupAutocomplete(inputId, suggestionsId) {
   const input = document.getElementById(inputId);
   const suggestions = document.getElementById(suggestionsId);

   input.addEventListener('input', (e) => {
       const value = e.target.value;
       suggestions.innerHTML = '';

       if (value.length < 2) return;

       const results = searchAirports(value);
       results.forEach(airport => {
           const div = document.createElement('div');
           div.className = 'suggestion-item';
           div.textContent = `${airport.code} - ${airport.city}, ${airport.country}`;
           div.addEventListener('click', () => {
               input.value = airport.code;
               input.dataset.code = airport.code;
               input.dataset.lat = airport.lat;
               input.dataset.lon = airport.lon;
               suggestions.innerHTML = '';
           });
           suggestions.appendChild(div);
       });
   });

   document.addEventListener('click', (e) => {
       if (e.target !== input) {
           suggestions.innerHTML = '';
       }
   });
}

function haversineDistance(lat1, lon1, lat2, lon2) {
   const R = 3958.8;
   const dLat = (lat2 - lat1) * Math.PI / 180;
   const dLon = (lon2 - lon1) * Math.PI / 180;
   const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dLon/2) * Math.sin(dLon/2);
   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
   return R * c;
}

function calculateFlightTime(distance) {
   return (distance / 500) + 0.5;
}

function setupTabs() {
   const tabBtns = document.querySelectorAll('.tab-btn');
   const tabContents = document.querySelectorAll('.tab-content');

   tabBtns.forEach(btn => {
       btn.addEventListener('click', () => {
           const tabName = btn.dataset.tab;
           
           tabBtns.forEach(b => b.classList.remove('active'));
           tabContents.forEach(c => c.classList.remove('active'));
           
           btn.classList.add('active');
           document.getElementById(tabName).classList.add('active');

           if (tabName === 'analysis') {
               updateAnalysis();
           } else if (tabName === 'raw-data') {
               displayFlights();
           }
       });
   });
}

function setupToggleButtons() {
   const toggleBtns = document.querySelectorAll('.toggle-btn');
   
   toggleBtns.forEach(btn => {
       btn.addEventListener('click', () => {
           const field = btn.dataset.field;
           const value = btn.dataset.value;
           
           document.querySelectorAll(`[data-field="${field}"]`).forEach(b => {
               b.classList.remove('selected');
           });
           
           btn.classList.add('selected');
       });
   });
}

async function handleFlightSubmit(e) {
   e.preventDefault();
   
   const errorDiv = document.getElementById('form-error');
   errorDiv.textContent = '';

   const type = document.querySelector('[data-field="type"].selected')?.dataset.value;
   const tripType = document.querySelector('[data-field="trip-type"].selected')?.dataset.value;
   const departInput = document.getElementById('depart-airport');
   const arrivalInput = document.getElementById('arrival-airport');
   const date = document.getElementById('date-traveled').value;
   const airline = document.getElementById('airline').value;
   const description = document.getElementById('description').value;

   if (!type || !tripType) {
       errorDiv.textContent = 'Please select all required options';
       return;
   }

   if (!departInput.dataset.code || !arrivalInput.dataset.code) {
       errorDiv.textContent = 'Please select valid airports from the suggestions';
       return;
   }

   const departCode = departInput.dataset.code;
   const arrivalCode = arrivalInput.dataset.code;
   const departLat = parseFloat(departInput.dataset.lat);
   const departLon = parseFloat(departInput.dataset.lon);
   const arrivalLat = parseFloat(arrivalInput.dataset.lat);
   const arrivalLon = parseFloat(arrivalInput.dataset.lon);

   const distance = haversineDistance(departLat, departLon, arrivalLat, arrivalLon);
   const hours = calculateFlightTime(distance);

   const flightData = {
       userId: currentUser.uid,
       type: type,
       departCode: departCode,
       arrivalCode: arrivalCode,
       date: date,
       airline: airline,
       description: description,
       distance: parseFloat(distance.toFixed(2)),
       hours: parseFloat(hours.toFixed(2)),
       isDeleted: 'N',
       createdAt: new Date().toISOString()
   };

   try {
       await addDoc(collection(db, 'flights'), flightData);

       if (tripType === 'Round Trip') {
           const returnFlight = {
               ...flightData,
               departCode: arrivalCode,
               arrivalCode: departCode
           };
           await addDoc(collection(db, 'flights'), returnFlight);
       }

       document.getElementById('flight-form').reset();
       document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('selected'));
       departInput.removeAttribute('data-code');
       departInput.removeAttribute('data-lat');
       departInput.removeAttribute('data-lon');
       arrivalInput.removeAttribute('data-code');
       arrivalInput.removeAttribute('data-lat');
       arrivalInput.removeAttribute('data-lon');

       alert('Flight(s) added successfully!');
       await loadFlights();
   } catch (error) {
       errorDiv.textContent = 'Error adding flight: ' + error.message;
   }
}

async function loadFlights() {
   if (!currentUser) return;

   const q = query(
       collection(db, 'flights'),
       where('userId', '==', currentUser.uid),
       where('isDeleted', '==', 'N'),
       orderBy('date', 'desc')
   );

   const querySnapshot = await getDocs(q);
   allFlights = [];
   querySnapshot.forEach((doc) => {
       allFlights.push({ id: doc.id, ...doc.data() });
   });
}

function displayFlights(filteredFlights = null) {
   const flights = filteredFlights || allFlights;
   const tbody = document.querySelector('#flights-table tbody');
   tbody.innerHTML = '';

   flights.forEach(flight => {
       const row = document.createElement('tr');
       const dateObj = new Date(flight.date);
       const formattedDate = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getDate().toString().padStart(2, '0')}/${dateObj.getFullYear().toString().slice(-2)}`;
       
       row.innerHTML = `
           <td>${formattedDate}</td>
           <td>${flight.departCode} → ${flight.arrivalCode}</td>
           <td>${flight.distance.toFixed(2)}</td>
           <td>${flight.hours.toFixed(2)}</td>
           <td>${flight.type}</td>
           <td>${flight.airline}</td>
           <td>${flight.description}</td>
           <td>
               <button class="action-btn edit-btn" onclick="editFlight('${flight.id}')">Edit</button>
               <button class="action-btn delete-btn" onclick="deleteFlight('${flight.id}')">Delete</button>
           </td>
       `;
       tbody.appendChild(row);
   });
}

function setupSearch() {
   const searchInput = document.getElementById('search-filter');
   searchInput.addEventListener('input', (e) => {
       const term = e.target.value.toLowerCase();
       
       if (!term) {
           displayFlights();
           return;
       }

       const filtered = allFlights.filter(flight => {
           const dateObj = new Date(flight.date);
           const formattedDate = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getDate().toString().padStart(2, '0')}/${dateObj.getFullYear().toString().slice(-2)}`;
           
           return formattedDate.includes(term) ||
                  flight.departCode.toLowerCase().includes(term) ||
                  flight.arrivalCode.toLowerCase().includes(term) ||
                  flight.type.toLowerCase().includes(term) ||
                  flight.airline.toLowerCase().includes(term) ||
                  flight.description.toLowerCase().includes(term);
       });

       displayFlights(filtered);
   });
}

window.editFlight = function(flightId) {
   const flight = allFlights.find(f => f.id === flightId);
   if (!flight) return;

   document.getElementById('edit-id').value = flight.id;
   document.getElementById('edit-depart').value = flight.departCode;
   document.getElementById('edit-arrival').value = flight.arrivalCode;
   document.getElementById('edit-date').value = flight.date;
   document.getElementById('edit-airline').value = flight.airline;
   document.getElementById('edit-description').value = flight.description;

   document.querySelectorAll('[data-field="edit-type"]').forEach(btn => {
       btn.classList.remove('selected');
       if (btn.dataset.value === flight.type) {
           btn.classList.add('selected');
       }
   });

   document.getElementById('edit-modal').classList.add('active');
};

window.closeEditModal = function() {
   document.getElementById('edit-modal').classList.remove('active');
};

async function handleEditSubmit(e) {
   e.preventDefault();

   const flightId = document.getElementById('edit-id').value;
   const type = document.querySelector('[data-field="edit-type"].selected')?.dataset.value;
   const departCode = document.getElementById('edit-depart').value.toUpperCase();
   const arrivalCode = document.getElementById('edit-arrival').value.toUpperCase();
   const date = document.getElementById('edit-date').value;
   const airline = document.getElementById('edit-airline').value;
   const description = document.getElementById('edit-description').value;

   if (!type) {
       alert('Please select a type');
       return;
   }

   const departAirport = airportData.find(a => a.code === departCode);
   const arrivalAirport = airportData.find(a => a.code === arrivalCode);

   if (!departAirport || !arrivalAirport) {
       alert('Invalid airport codes');
       return;
   }

   const distance = haversineDistance(
       departAirport.lat, departAirport.lon,
       arrivalAirport.lat, arrivalAirport.lon
   );
   const hours = calculateFlightTime(distance);

   try {
       await updateDoc(doc(db, 'flights', flightId), {
           type: type,
           departCode: departCode,
           arrivalCode: arrivalCode,
           date: date,
           airline: airline,
           description: description,
           distance: parseFloat(distance.toFixed(2)),
           hours: parseFloat(hours.toFixed(2))
       });

       closeEditModal();
       await loadFlights();
       displayFlights();
       updateAnalysis();
   } catch (error) {
       alert('Error updating flight: ' + error.message);
   }
}

window.deleteFlight = async function(flightId) {
   if (!confirm('Are you sure you want to delete this flight?')) return;

   try {
       await updateDoc(doc(db, 'flights', flightId), {
           isDeleted: 'Y'
       });

       await loadFlights();
       displayFlights();
       updateAnalysis();
   } catch (error) {
       alert('Error deleting flight: ' + error.message);
