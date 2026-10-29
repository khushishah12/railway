const searchForm = document.getElementById('searchForm');
const trainResults = document.getElementById('trainResults');
const searchMessage = document.getElementById('searchMessage');
const bookingDialog = document.getElementById('bookingDialog');
const bookingForm = document.getElementById('bookingForm');
const bookingMessage = document.getElementById('bookingMessage');
const historyForm = document.getElementById('historyForm');
const bookingResults = document.getElementById('bookingResults');
const historyMessage = document.getElementById('historyMessage');

let selectedFare = 0;
let toastTimer;

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Request failed.');
    }

    return data;
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

function showMessage(element, message, type = '') {
    element.textContent = message;
    element.className = 'message ' + type;
}

function notify(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function formatTime(time) {
    return String(time || '').slice(0, 5);
}

// Search trains
searchForm.addEventListener('submit', async event => {
    event.preventDefault();

    const source = document.getElementById('source').value.trim();
    const destination = document.getElementById('destination').value.trim();

    if (!source || !destination) {
        showMessage(searchMessage, 'Enter both source and destination.', 'error');
        return;
    }

    trainResults.replaceChildren();
    showMessage(searchMessage, 'Searching trains...');

    try {
        const trains = await api(
            `/api/trains?source=${encodeURIComponent(source)}&destination=${encodeURIComponent(destination)}`
        );

        if (!trains.length) {
            showMessage(searchMessage, 'No trains found for this route.');
            return;
        }

        showMessage(searchMessage, `${trains.length} train(s) found.`, 'success');

        trains.forEach(train => {
            const card = document.createElement('article');
            card.className = 'train-card';

            const seats = Number(train.available_seats);
            const fullClass = seats === 0 ? 'full' : '';

            card.innerHTML = `
                <h3>${escapeHTML(train.train_name)}</h3>
                <p class="route">${escapeHTML(train.source)} → ${escapeHTML(train.destination)}</p>
                <p class="muted">Departure: ${escapeHTML(formatTime(train.departure_time))}</p>
                <p class="muted">Arrival: ${escapeHTML(formatTime(train.arrival_time))}</p>
                <span class="seat-badge ${fullClass}">
                    ${seats} seat(s) available
                </span>
                <p class="fare">₹${Number(train.fare).toFixed(2)}
                    <span class="muted">/ seat</span>
                </p>
                <button type="button" class="book-button" ${seats === 0 ? 'disabled' : ''}>
                    ${seats === 0 ? 'Sold Out' : 'Book Ticket'}
                </button>
            `;

            card.querySelector('.book-button').addEventListener('click', () => {
                selectedFare = Number(train.fare);
                document.getElementById('trainId').value = train.train_id;
                document.getElementById('selectedTrain').textContent =
                    `${train.train_name} — ${train.source} to ${train.destination}`;
                document.getElementById('seats').value = 1;
                document.getElementById('seats').max = Math.min(seats, 10);
                document.getElementById('passengerName').value = '';
                showMessage(bookingMessage, '');
                updateFare();
                bookingDialog.showModal();
            });

            trainResults.appendChild(card);
        });
    } catch (error) {
        showMessage(searchMessage, error.message, 'error');
    }
});

function updateFare() {
    const seats = Number(document.getElementById('seats').value);
    const total = Number.isInteger(seats) && seats > 0
        ? selectedFare * seats
        : 0;

    document.getElementById('farePreview').textContent =
        `Total fare: ₹${total.toFixed(2)}`;
}

document.getElementById('seats').addEventListener('input', updateFare);

document.getElementById('cancelBooking').addEventListener('click', () => {
    bookingDialog.close();
});

// Book ticket
bookingForm.addEventListener('submit', async event => {
    event.preventDefault();

    const button = bookingForm.querySelector('button[type="submit"]');
    const passengerName = document.getElementById('passengerName').value.trim();
    const seats = Number(document.getElementById('seats').value);
    const trainId = Number(document.getElementById('trainId').value);

    if (!passengerName || !Number.isInteger(seats) || seats < 1 ||
        seats > Number(document.getElementById('seats').max)) {
        showMessage(bookingMessage, 'Enter a valid name and seat quantity.', 'error');
        return;
    }

    button.disabled = true;
    showMessage(bookingMessage, 'Processing booking...');

    try {
        const booking = await api('/api/bookings', {
            method: 'POST',
            body: JSON.stringify({
                train_id: trainId,
                passenger_name: passengerName,
                seats
            })
        });

        showMessage(
            bookingMessage,
            `Booking confirmed! ID: ${booking.booking_id}. Total: ₹${Number(booking.total_fare).toFixed(2)}`,
            'success'
        );

        notify(`Ticket booked! Booking ID: ${booking.booking_id}`);

        // Keep the confirmation visible briefly before closing.
        setTimeout(() => {
            if (bookingDialog.open) bookingDialog.close();
        }, 1800);

        // Refresh search results and booking history.
        searchForm.requestSubmit();
        historyForm.requestSubmit();
    } catch (error) {
        showMessage(bookingMessage, error.message, 'error');
    } finally {
        button.disabled = false;
    }
});

// Booking history
historyForm.addEventListener('submit', async event => {
    event.preventDefault();

    const name = document.getElementById('passengerSearch').value.trim();

    bookingResults.innerHTML =
        '<tr><td colspan="6">Loading bookings...</td></tr>';
    showMessage(historyMessage, '');

    try {
        const bookings = await api(
            `/api/bookings?name=${encodeURIComponent(name)}`
        );

        bookingResults.replaceChildren();

        if (!bookings.length) {
            bookingResults.innerHTML =
                '<tr><td colspan="6">No bookings found.</td></tr>';
            showMessage(historyMessage, 'No matching reservations.');
            return;
        }

        bookings.forEach(booking => {
            const row = document.createElement('tr');

            row.innerHTML = `
                <td>#${Number(booking.booking_id)}</td>
                <td>${escapeHTML(booking.passenger_name)}</td>
                <td>${escapeHTML(booking.train_name)}</td>
                <td>${escapeHTML(booking.source)} → ${escapeHTML(booking.destination)}</td>
                <td>${Number(booking.seats)}</td>
                <td>₹${Number(booking.total_fare).toFixed(2)}</td>
            `;

            bookingResults.appendChild(row);
        });

        showMessage(historyMessage, `${bookings.length} booking(s) found.`, 'success');
    } catch (error) {
        bookingResults.innerHTML =
            '<tr><td colspan="6">Could not load bookings.</td></tr>';
        showMessage(historyMessage, error.message, 'error');
    }
});