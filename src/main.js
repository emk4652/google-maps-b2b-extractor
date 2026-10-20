import fs from 'node:fs';
import path from 'node:path';

async function getRuntime() {
    try {
        const { Actor } = await import('apify');
        await Actor.init();
        return {
            isApify: true,
            getInput: async () => (await Actor.getInput()) || {},
            pushData: async (item) => {
                try {
                    await Actor.pushData(item, 'place-extracted');
                } catch {
                    await Actor.pushData(item);
                }
            },
            charge: async (eventName, count = 1) => {
                if (typeof Actor.charge === 'function') {
                    try {
                        await Actor.charge({ eventName, count });
                    } catch {
                        // Ignore outside PPE billing
                    }
                }
            },
            exit: async () => Actor.exit(),
        };
    } catch {
        const inputPath = path.resolve(process.cwd(), 'INPUT.json');
        const localInput = fs.existsSync(inputPath)
            ? JSON.parse(fs.readFileSync(inputPath, 'utf8'))
            : {
                  searchQueries: ['coworking London'],
                  maxResultsPerQuery: 5,
                  enrichFromWebsite: false,
              };
        const outDir = path.resolve(process.cwd(), 'storage', 'datasets', 'default');
        fs.mkdirSync(outDir, { recursive: true });
        let counter = 1;
        return {
            isApify: false,
            getInput: async () => localInput,
            pushData: async (item) => {
                const file = path.join(outDir, `${String(counter++).padStart(9, '0')}.json`);
                fs.writeFileSync(file, JSON.stringify(item, null, 2), 'utf8');
            },
            charge: async () => {},
            exit: async () => {},
        };
    }
}

function extractEmailFromHtml(html) {
    const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12})/i);
    if (mailto) return mailto[1].toLowerCase().trim();
    const raw = html.match(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}\b/g) || [];
    for (const candidate of raw) {
        const clean = candidate.toLowerCase();
        if (
            !clean.endsWith('.png') &&
            !clean.endsWith('.jpg') &&
            !clean.endsWith('.svg') &&
            !clean.includes('example.com') &&
            !clean.includes('sentry.io')
        ) {
            return clean;
        }
    }
    return null;
}

async function enrichWebsiteContact(websiteUrl) {
    if (!websiteUrl) return { email: null, phone: null };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const target = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
        const res = await fetch(target, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ApifyB2BPlacesExtractor/1.0)',
            },
        });
        if (!res.ok) return { email: null, phone: null };
        const html = await res.text();
        const email = extractEmailFromHtml(html);
        const telMatch = html.match(/tel:([+\d\s().-]{8,20})/i);
        const phone = telMatch ? telMatch[1].replace(/[^\d+]/g, '') : null;
        return { email, phone };
    } catch {
        return { email: null, phone: null };
    } finally {
        clearTimeout(timer);
    }
}

async function searchPlacesForQuery(query, limit = 10) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        query
    )}&format=jsonv2&addressdetails=1&extratags=1&namedetails=1&limit=${Math.min(limit, 50)}`;

    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Apify-GoogleMaps-B2B-Extractor/1.0 (contact: emk4652@imnovaonline.com)',
            Accept: 'application/json',
        },
    });
    if (!res.ok) {
        throw new Error(`Geo Places API HTTP ${res.status}`);
    }
    return await res.json();
}

async function run() {
    const runtime = await getRuntime();
    const input = await runtime.getInput();

    const searchQueries =
        Array.isArray(input.searchQueries) && input.searchQueries.length > 0
            ? input.searchQueries
            : ['coworking London'];
    const maxResultsPerQuery = Number(input.maxResultsPerQuery) || 10;
    const enrichFromWebsite = input.enrichFromWebsite !== false;

    console.log(`[Google-Maps-B2B-Extractor] Processing ${searchQueries.length} commercial query(s)...`);

    for (const query of searchQueries) {
        try {
            const rawPlaces = await searchPlacesForQuery(query, maxResultsPerQuery);
            for (const place of rawPlaces.slice(0, maxResultsPerQuery)) {
                const extratags = place.extratags || {};
                const addr = place.address || {};

                let website = extratags.website || extratags['contact:website'] || extratags.url || null;
                let phone = extratags.phone || extratags['contact:phone'] || null;
                let email = extratags.email || extratags['contact:email'] || null;

                if (enrichFromWebsite && website && (!email || !phone)) {
                    const enriched = await enrichWebsiteContact(website);
                    if (!email && enriched.email) email = enriched.email;
                    if (!phone && enriched.phone) phone = enriched.phone;
                }

                const cleanName = String(
                    place.name || place.namedetails?.name || place.display_name?.split(',')[0] || 'Business Entity'
                ).replace(/\u2014/g, '-');

                const record = {
                    searchQuery: query,
                    placeId: String(place.place_id || place.osm_id),
                    businessName: cleanName,
                    category: place.type || place.category || 'commercial',
                    phone,
                    email,
                    website,
                    openingHours: extratags.opening_hours || null,
                    street: [addr.house_number, addr.road].filter(Boolean).join(' ') || null,
                    city: addr.city || addr.town || addr.village || addr.county || null,
                    state: addr.state || null,
                    postalCode: addr.postcode || null,
                    country: addr.country || null,
                    countryCode: addr.country_code ? addr.country_code.toUpperCase() : null,
                    address: String(place.display_name || '').replace(/\u2014/g, '-'),
                    latitude: place.lat ? Number(place.lat) : null,
                    longitude: place.lon ? Number(place.lon) : null,
                    googleMapsUrl:
                        place.lat && place.lon
                            ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`
                            : null,
                    scrapedAt: new Date().toISOString(),
                };

                await runtime.pushData(record);
                await runtime.charge('place-extracted', 1);
            }
            console.log(`[Google-Maps-B2B-Extractor] Completed query "${query}" (${rawPlaces.length} places).`);
        } catch (err) {
            console.error(`[Google-Maps-B2B-Extractor] Error on query "${query}": ${err.message}`);
        }
    }

    await runtime.exit();
}

run();
