const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', // Set your MySQL password here if required
    database: 'railway_db',
    waitForConnections: true,
    connectionLimit: 10
});

function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
};

async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const route = url.pathname;
    const method = req.method;

    // Search trains
    if (route === '/api/trains' && method === 'GET') {
        const source = url.searchParams.get('source') || '';
        const destination = url.searchParams.get('destination') || '';

        const [trains] = await pool.execute(
            `SELECT * FROM Trains
             WHERE source LIKE ? AND destination LIKE ?
             ORDER BY departure_time`,
            [`%${source}%`, `%${destination}%`]
        );

        return send(res, 200, trains);
    }

    // Book a ticket
    if (route === '/api/bookings' && method === 'POST') {
        const body = await readBody(req);
        const trainId = Number(body.train_id);
        const seats = Number(body.seats);
        const passengerName = typeof body.passenger_name === 'string'
            ? body.passenger_name.trim()
            : '';

        if (!Number.isInteger(trainId) || trainId < 1 ||
            !Number.isInteger(seats) || seats < 1 ||
            !passengerName || passengerName.length > 100) {
            return send(res, 400, {
                error: 'Enter a valid passenger name, train, and seat quantity.'
            });
        }

        const conn = await pool.getConnection();

        try {
            await conn.beginTransaction();

            const [trains] = await conn.execute(
                'SELECT * FROM Trains WHERE train_id = ? FOR UPDATE',
                [trainId]
            );

            if (trains.length === 0) {
                await conn.rollback();
                return send(res, 404, { error: 'Train not found.' });
            }

            const train = trains[0];

            if (train.available_seats < seats) {
                await conn.rollback();
                return send(res, 400, {
                    error: `Only ${train.available_seats} seats are available.`
                });
            }

            const totalFare = Number(train.fare) * seats;

            const [result] = await conn.execute(
                `INSERT INTO Bookings
                 (train_id, passenger_name, seats, total_fare)
                 VALUES (?, ?, ?, ?)`,
                [trainId, passengerName, seats, totalFare]
            );

            await conn.execute(
                `UPDATE Trains
                 SET available_seats = available_seats - ?
                 WHERE train_id = ?`,
                [seats, trainId]
            );

            await conn.commit();

            return send(res, 201, {
                message: 'Ticket booked successfully!',
                booking_id: result.insertId,
                passenger_name: passengerName,
                train_name: train.train_name,
                source: train.source,
                destination: train.destination,
                seats,
                total_fare: totalFare
            });
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // View booking history; optional name filter
    if (route === '/api/bookings' && method === 'GET') {
        const name = url.searchParams.get('name') || '';

        const [bookings] = await pool.execute(
            `SELECT b.booking_id, b.passenger_name, b.seats,
                    b.total_fare, b.booking_date,
                    t.train_name, t.source, t.destination,
                    t.departure_time, t.arrival_time
             FROM Bookings b
             JOIN Trains t ON b.train_id = t.train_id
             WHERE b.passenger_name LIKE ?
             ORDER BY b.booking_date DESC`,
            [`%${name}%`]
        );

        return send(res, 200, bookings);
    }

    // Serve frontend files
    if (method === 'GET' && !route.startsWith('/api/')) {
        let filePath;

        try {
            const decoded = decodeURIComponent(route);
            const relativePath = decoded === '/' ? 'index.html' : decoded.slice(1);
            filePath = path.resolve(PUBLIC_DIR, relativePath);

            if (!filePath.startsWith(PUBLIC_DIR + path.sep) &&
                filePath !== path.join(PUBLIC_DIR, 'index.html')) {
                return send(res, 403, { error: 'Forbidden' });
            }
        } catch {
            return send(res, 400, { error: 'Invalid path' });
        }

        fs.readFile(filePath, (error, content) => {
            if (error) {
                return send(res, 404, { error: 'File not found' });
            }

            res.writeHead(200, {
                'Content-Type': mimeTypes[path.extname(filePath)] ||
                    'application/octet-stream'
            });
            res.end(content);
        });
        return;
    }

    return send(res, 404, { error: 'Route not found' });
}

const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(error => {
        console.error(error);

        if (!res.headersSent && !res.destroyed) {
            const status = error.message === 'Invalid JSON' ? 400 :
                error.message === 'Request body too large' ? 413 : 500;

            send(res, status, {
                error: status === 500
                    ? 'Internal server error'
                    : error.message
            });
        } else if (!res.destroyed) {
            res.end();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Railway Reservation running at http://localhost:${PORT}`);
});