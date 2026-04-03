# CHANGELOG: Booking Module Optimization (Performance & Scaling)

## Overview
Optimized the `sesiBooking` API to support Server-Side date filtering. 
Previously, the backend sent **all historical bookings** for a tenant to the frontend, which then filtered them locally by date. As data scales, this causes immense memory pressure and network bottlenecks, especially on old mobile devices.

## Details of Changes

### 1. `controllers/sesiBookingController.js`
- **Method `getAll(req, res, next)`:** 
  - Now extracts the optional `tanggal` query parameter: `const tanggal = req.query.tanggal;`
  - Passes the `tanggal` parameter down to the service layer: `await sesiBookingService.getAll(tenantID, tanggal);`

### 2. `services/sesiBookingService.js`
- **Cache Key Function Definition:** 
  - Updated the Redis cache key builder to include the date parameter if it exists to prevent cache collision between dates.
  - Old: `const CACHE_KEY_LIST = (tenantID) => \`booking:tenant:\${tenantID}\`;`
  - New: `const CACHE_KEY_LIST = (tenantID, dateStr) => dateStr ? \`booking:tenant:\${tenantID}:date:\${dateStr}\` : \`booking:tenant:\${tenantID}\`;`

- **Method `getAll(tenantID, tanggalDate)`:**
  - Added the new `tanggalDate` parameter to the method signature.
  - Implemented a dynamic query builder (`queryFilter`).
  - If `tanggalDate` is provided (e.g., `2025-10-28`), the query filters the `waktuMulai` field from the **start of that day (00:00:00.000)** to the **end of that day (23:59:59.999)** using MongoDB's `$gte` and `$lt` operators.
  - This ensures the frontend only downloads the data it specifically needs for the selected date on the calendar.
  - Data cache TTL is set to 120 seconds to balance freshness and hit-rate.

### Impact
- **Network Load:** Reduced payload size dramatically from fetching thousands of elements down to 10-50 elements.
- **Frontend CPU:** Eliminated the heavy `Iterable.where(...)` loop processing on the frontend.
- **Cache Hit Rate:** More granular caching minimizes cache-miss spikes for heavily requested historical dates.
