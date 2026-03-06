import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, signInWithPopup, signOut, GoogleAuthProvider, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
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

function formatNumber(num) {
   return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadAirportData() {
   try {
       const response = await fetch(AIRPORTS_URL);
       const data = await response.json();
       airportData = Object.entries(data)
           .filter(([code, info]) => info.iata && info.iata !== '')
           .map(([code, info]) => ({
               code: info.iata,
               name: info.name || '',
               city: info.city || '',
               country: info.country || '',
               lat: parseFloat(info.lat) || 0,
               lon: parseFloat(info.lon) || 0
           })).filter(airport => airport.lat !== 0 && airport.lon !== 0);
   } catch (error) {
       console.error('Error loading airport data:', error);
   }
}

function searchAirports(searchTerm) {
   if (!searchTerm || searchTerm.length < 2) return [];
   const term = searchTerm.toUpperCase();
   return airportData.filter(airport => {
       const codeMatch = airport.code && airport.code.toUpperCase().includes(term);
       const nameMatch = airport.name && airport.name.toUpperCase().includes(term);
       const cityMatch = airport.city && airport.city.toUpperCase().includes(term);
       return codeMatch || nameMatch || cityMatch;
   }).slice(0, 15);
}

function setupAutocomplete(inputId, suggestionsId) {
   const input = document.getElementById(inputId);
   const suggestions = document.getElementById(suggestionsId);

   input.addEventListener('input', (e) => {
       const value = e.target.value;
       suggestions.innerHTML = '';
       if (value.length < 2) return;

       const results = searchAirports(value);
       if (results.length === 0) {
           const div = document.createElement('div');
           div.className = 'suggestion-item';
           div.textContent = 'No airports found';
           div.style.color = '#999';
           suggestions.appendChild(div);
           return;
       }

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
       if (e.target !== input) suggestions.innerHTML = '';
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
   let speed;
   if (distance < 500) speed = 350;
   else if (distance < 1500) speed = 450;
   else if (distance < 3000) speed = 500;
   else speed = 525;
   return (distance / speed) + 0.5;
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
           if (tabName === 'analysis') updateAnalysis();
           else if (tabName === 'raw-data') displayFlights();
       });
   });
}

function setupToggleButtons() {
   document.querySelectorAll('.toggle-btn').forEach(btn => {
       btn.addEventListener('click', () => {
           const field = btn.dataset.field;
           const value = btn.dataset.value;
           document.querySelectorAll(`[data-field="${field}"]`).forEach(b => b.classList.remove('selected'));
           btn.classList.add('selected');

           if (field === 'trip-type') {
               const oneWayGroup = document.getElementById('date-group-oneway');
               const roundTripGroup = document.getElementById('date-group-roundtrip');
               const oneWayDate = document.getElementById('date-traveled');
               const leg1Date = document.getElementById('date-traveled-leg1');
               const leg2Date = document.getElementById('date-traveled-leg2');

               if (value === 'Round Trip') {
                   oneWayGroup.style.display = 'none';
                   roundTripGroup.style.display = 'block';
                   oneWayDate.removeAttribute('required');
                   leg1Date.setAttribute('required', 'required');
                   leg2Date.setAttribute('required', 'required');
               } else {
                   oneWayGroup.style.display = 'block';
                   roundTripGroup.style.display = 'none';
                   oneWayDate.setAttribute('required', 'required');
                   leg1Date.removeAttribute('required');
                   leg2Date.removeAttribute('required');
               }
           }
       });
   });
}

async function handleFlightSubmit(e) {
   e.preventDefault();
   if (!currentUser) { alert('You must be signed in to add flights'); return; }
   
   const errorDiv = document.getElementById('form-error');
   errorDiv.textContent = '';

   const type = document.querySelector('[data-field="type"].selected')?.dataset.value;
   const tripType = document.querySelector('[data-field="trip-type"].selected')?.dataset.value;
   const departInput = document.getElementById('depart-airport');
   const arrivalInput = document.getElementById('arrival-airport');
   const airline = document.getElementById('airline').value;
   const description = document.getElementById('description').value;

   if (!type || !tripType) { errorDiv.textContent = 'Please select all required options'; return; }
   if (!departInput.dataset.code || !arrivalInput.dataset.code) { errorDiv.textContent = 'Please select valid airports from the suggestions'; return; }

   const departCode = departInput.dataset.code;
   const arrivalCode = arrivalInput.dataset.code;
   const distance = haversineDistance(parseFloat(departInput.dataset.lat), parseFloat(departInput.dataset.lon), parseFloat(arrivalInput.dataset.lat), parseFloat(arrivalInput.dataset.lon));
   const hours = calculateFlightTime(distance);

   try {
       if (tripType === 'Round Trip') {
           const leg1Date = document.getElementById('date-traveled-leg1').value;
           const leg2Date = document.getElementById('date-traveled-leg2').value;
           if (!leg1Date || !leg2Date) { errorDiv.textContent = 'Please enter both dates for round trip'; return; }

           const base = { userId: currentUser.uid, type, airline, description, distance: parseFloat(distance.toFixed(2)), hours: parseFloat(hours.toFixed(2)), isDeleted: 'N', createdAt: new Date().toISOString() };
           await addDoc(collection(db, 'flights'), { ...base, departCode, arrivalCode, date: leg1Date });
           await addDoc(collection(db, 'flights'), { ...base, departCode: arrivalCode, arrivalCode: departCode, date: leg2Date });
       } else {
           const date = document.getElementById('date-traveled').value;
           if (!date) { errorDiv.textContent = 'Please enter a date'; return; }
           await addDoc(collection(db, 'flights'), { userId: currentUser.uid, type, departCode, arrivalCode, date, airline, description, distance: parseFloat(distance.toFixed(2)), hours: parseFloat(hours.toFixed(2)), isDeleted: 'N', createdAt: new Date().toISOString() });
       }

       document.getElementById('flight-form').reset();
       document.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('selected'));
       departInput.removeAttribute('data-code'); departInput.removeAttribute('data-lat'); departInput.removeAttribute('data-lon');
       arrivalInput.removeAttribute('data-code'); arrivalInput.removeAttribute('data-lat'); arrivalInput.removeAttribute('data-lon');
       document.getElementById('date-group-oneway').style.display = 'block';
       document.getElementById('date-group-roundtrip').style.display = 'none';

       alert('Flight(s) added successfully!');
       await loadFlights();
       displayFlights();
       updateAnalysis();
   } catch (error) {
       errorDiv.textContent = 'Error adding flight: ' + error.message;
   }
}

async function loadFlights() {
   if (!currentUser) return;
   const q = query(collection(db, 'flights'), where('userId', '==', currentUser.uid), where('isDeleted', '==', 'N'), orderBy('date', 'desc'));
   const querySnapshot = await getDocs(q);
   allFlights = [];
   querySnapshot.forEach((d) => { allFlights.push({ id: d.id, ...d.data() }); });
}

function displayFlights(filteredFlights) {
   const flights = filteredFlights || allFlights;
   const tbody = document.querySelector('#flights-table tbody');
   tbody.innerHTML = '';
   flights.forEach(flight => {
       const row = document.createElement('tr');
       const dateObj = new Date(flight.date + 'T00:00:00');
       const formattedDate = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getDate().toString().padStart(2, '0')}/${dateObj.getFullYear().toString().slice(-2)}`;
       row.innerHTML = `<td>${formattedDate}</td><td>${flight.departCode} → ${flight.arrivalCode}</td><td>${formatNumber(flight.distance)}</td><td>${formatNumber(flight.hours)}</td><td>${flight.type}</td><td>${flight.airline}</td><td>${flight.description}</td><td><button class="action-btn edit-btn" onclick="editFlight('${flight.id}')">Edit</button><button class="action-btn delete-btn" onclick="deleteFlight('${flight.id}')">Delete</button></td>`;
       tbody.appendChild(row);
   });
}

function setupSearch() {
   document.getElementById('search-filter').addEventListener('input', (e) => {
       const term = e.target.value.toLowerCase();
       if (!term) { displayFlights(); return; }
       const filtered = allFlights.filter(flight => {
           const dateObj = new Date(flight.date + 'T00:00:00');
           const formattedDate = `${(dateObj.getMonth() + 1).toString().padStart(2, '0')}/${dateObj.getDate().toString().padStart(2, '0')}/${dateObj.getFullYear().toString().slice(-2)}`;
           return formattedDate.includes(term) || flight.departCode.toLowerCase().includes(term) || flight.arrivalCode.toLowerCase().includes(term) || flight.type.toLowerCase().includes(term) || flight.airline.toLowerCase().includes(term) || flight.description.toLowerCase().includes(term);
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
       if (btn.dataset.value === flight.type) btn.classList.add('selected');
   });
   document.getElementById('edit-modal').classList.add('active');
};

window.closeEditModal = function() { document.getElementById('edit-modal').classList.remove('active'); };

async function handleEditSubmit(e) {
   e.preventDefault();
   const flightId = document.getElementById('edit-id').value;
   const type = document.querySelector('[data-field="edit-type"].selected')?.dataset.value;
   const departCode = document.getElementById('edit-depart').value.toUpperCase();
   const arrivalCode = document.getElementById('edit-arrival').value.toUpperCase();
   const date = document.getElementById('edit-date').value;
   const airline = document.getElementById('edit-airline').value;
   const description = document.getElementById('edit-description').value;

   if (!type) { alert('Please select a type'); return; }
   const departAirport = airportData.find(a => a.code === departCode);
   const arrivalAirport = airportData.find(a => a.code === arrivalCode);
   if (!departAirport || !arrivalAirport) { alert('Invalid airport codes'); return; }

   const distance = haversineDistance(departAirport.lat, departAirport.lon, arrivalAirport.lat, arrivalAirport.lon);
   const hours = calculateFlightTime(distance);

   try {
       await updateDoc(doc(db, 'flights', flightId), { type, departCode, arrivalCode, date, airline, description, distance: parseFloat(distance.toFixed(2)), hours: parseFloat(hours.toFixed(2)) });
       closeEditModal();
       await loadFlights();
       displayFlights();
       updateAnalysis();
   } catch (error) { alert('Error updating flight: ' + error.message); }
}

window.deleteFlight = async function(flightId) {
   if (!confirm('Are you sure you want to delete this flight?')) return;
   try {
       await updateDoc(doc(db, 'flights', flightId), { isDeleted: 'Y' });
       await loadFlights();
       displayFlights();
       updateAnalysis();
   } catch (error) { alert('Error deleting flight: ' + error.message); }
};

function updateAnalysis() {
   const totalFlights = allFlights.length;
   const totalMiles = allFlights.reduce((sum, f) => sum + f.distance, 0);
   const totalHours = allFlights.reduce((sum, f) => sum + f.hours, 0);
   const routes = new Set(allFlights.map(f => `${f.departCode} → ${f.arrivalCode}`));
   
   document.getElementById('stat-flights').textContent = totalFlights.toLocaleString();
   document.getElementById('stat-miles').textContent = formatNumber(totalMiles);
   document.getElementById('stat-hours').textContent = formatNumber(totalHours);
   document.getElementById('stat-routes').textContent = routes.size.toLocaleString();
   document.getElementById('stat-miles-per-flight').textContent = totalFlights > 0 ? formatNumber(totalMiles / totalFlights) : '0.00';
   document.getElementById('stat-hours-per-flight').textContent = totalFlights > 0 ? formatNumber(totalHours / totalFlights) : '0.00';
   document.getElementById('stat-earths').textContent = formatNumber(totalMiles / 24880);

   if (allFlights.length > 0) {
       const longest = allFlights.reduce((max, f) => f.distance > max.distance ? f : max);
       const shortest = allFlights.reduce((min, f) => f.distance < min.distance ? f : min);
       const longestRoute = [longest.departCode, longest.arrivalCode].sort().join(' & ');
       const shortestRoute = [shortest.departCode, shortest.arrivalCode].sort().join(' & ');
       document.getElementById('stat-longest').textContent = `${longestRoute} (${formatNumber(longest.distance)} mi & ${formatNumber(longest.hours)} hrs)`;
       document.getElementById('stat-shortest').textContent = `${shortestRoute} (${formatNumber(shortest.distance)} mi & ${formatNumber(shortest.hours)} hrs)`;

       const airportCounts = {};
       allFlights.forEach(flight => {
           if (!airportCounts[flight.departCode]) airportCounts[flight.departCode] = { departures: 0, arrivals: 0 };
           if (!airportCounts[flight.arrivalCode]) airportCounts[flight.arrivalCode] = { departures: 0, arrivals: 0 };
           airportCounts[flight.departCode].departures++;
           airportCounts[flight.arrivalCode].arrivals++;
       });
       const topAirport = Object.entries(airportCounts).sort((a, b) => (b[1].departures + b[1].arrivals) - (a[1].departures + a[1].arrivals))[0];
       document.getElementById('stat-frequent-airport').textContent = `${topAirport[0]} (${topAirport[1].departures} Departures & ${topAirport[1].arrivals} Arrivals)`;
   }

   const yearlyData = {};
   allFlights.forEach(flight => {
       const year = new Date(flight.date + 'T00:00:00').getFullYear();
       if (!yearlyData[year]) yearlyData[year] = { flights: 0, miles: 0, hours: 0 };
       yearlyData[year].flights++;
       yearlyData[year].miles += flight.distance;
       yearlyData[year].hours += flight.hours;
   });
   const yearlyTbody = document.querySelector('#yearly-table tbody');
   yearlyTbody.innerHTML = '';
   Object.keys(yearlyData).sort().reverse().forEach(year => {
       const d = yearlyData[year];
       yearlyTbody.innerHTML += `<tr><td>${year}</td><td>${d.flights.toLocaleString()}</td><td>${formatNumber(d.miles)}</td><td>${formatNumber(d.hours)}</td></tr>`;
   });

   const airlineData = {};
   allFlights.forEach(flight => {
       if (!airlineData[flight.airline]) airlineData[flight.airline] = { flights: 0, miles: 0, hours: 0 };
       airlineData[flight.airline].flights++;
       airlineData[flight.airline].miles += flight.distance;
       airlineData[flight.airline].hours += flight.hours;
   });
   const airlineTbody = document.querySelector('#airline-table tbody');
   airlineTbody.innerHTML = '';
   Object.entries(airlineData).sort((a, b) => b[1].flights - a[1].flights).forEach(([airline, d]) => {
       airlineTbody.innerHTML += `<tr><td>${airline}</td><td>${d.flights.toLocaleString()}</td><td>${formatNumber(d.miles)}</td><td>${formatNumber(d.hours)}</td></tr>`;
   });

   const typeData = {};
   allFlights.forEach(flight => {
       if (!typeData[flight.type]) typeData[flight.type] = { flights: 0, miles: 0, hours: 0 };
       typeData[flight.type].flights++;
       typeData[flight.type].miles += flight.distance;
       typeData[flight.type].hours += flight.hours;
   });
   const typeTbody = document.querySelector('#type-table tbody');
   typeTbody.innerHTML = '';
   Object.keys(typeData).forEach(type => {
       const d = typeData[type];
       typeTbody.innerHTML += `<tr><td>${type}</td><td>${d.flights.toLocaleString()}</td><td>${formatNumber(d.miles)}</td><td>${formatNumber(d.hours)}</td></tr>`;
   });

   const routeData = {};
   allFlights.forEach(flight => {
       const route = `${flight.departCode} → ${flight.arrivalCode}`;
       if (!routeData[route]) routeData[route] = { flights: 0, miles: 0, hours: 0 };
       routeData[route].flights++;
       routeData[route].miles += flight.distance;
       routeData[route].hours += flight.hours;
   });
   const routeTbody = document.querySelector('#route-table tbody');
   routeTbody.innerHTML = '';
   Object.entries(routeData).sort((a, b) => b[1].flights - a[1].flights).forEach(([route, d]) => {
       routeTbody.innerHTML += `<tr><td>${route}</td><td>${d.flights.toLocaleString()}</td><td>${formatNumber(d.miles)}</td><td>${formatNumber(d.hours)}</td></tr>`;
   });
}

async function handleAuth() {
   onAuthStateChanged(auth, async (user) => {
       if (user) {
           currentUser = user;
           document.getElementById('auth-container').style.display = 'none';
           document.querySelector('.container').style.display = 'block';
           document.getElementById('user-email').textContent = user.email;
           await loadFlights();
           displayFlights();
           updateAnalysis();
       } else {
           currentUser = null;
           document.getElementById('auth-container').style.display = 'flex';
           document.querySelector('.container').style.display = 'none';
       }
   });
}

async function init() {
   await loadAirportData();
   setupTabs();
   setupToggleButtons();
   setupAutocomplete('depart-airport', 'depart-suggestions');
   setupAutocomplete('arrival-airport', 'arrival-suggestions');
   setupSearch();
   document.getElementById('flight-form').addEventListener('submit', handleFlightSubmit);
   document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);
   document.getElementById('sign-in-btn').addEventListener('click', async () => {
       try { await signInWithPopup(auth, new GoogleAuthProvider()); }
       catch (error) { console.error('Sign in error:', error); alert('Error signing in: ' + error.message); }
   });
   document.getElementById('sign-out-btn').addEventListener('click', async () => {
       try { await signOut(auth); }
       catch (error) { console.error('Sign out error:', error); alert('Error signing out: ' + error.message); }
   });
   await handleAuth();
}

init();
