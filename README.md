# Google Maps & Local B2B Business Directory Extractor

Extracts verified B2B commercial listings, geo-coordinates, direct Google Maps links, structured street addresses, phone numbers, websites, and corporate email addresses by industry keyword and city.

## Core Capabilities

- **Geo-Targeted B2B Discovery**: Queries commercial POIs by category and city (e.g., `coworking London`, `dental clinic Miami`, `logistics Madrid`).
- **Direct Website Contact Enrichment**: Automatically visits discovered business websites to extract missing corporate email addresses and phone numbers.
- **Ready for Outbound CRM Pipelines**: Outputs clean fields including `businessName`, `category`, `phone`, `email`, `website`, `address`, `latitude`, `longitude`, and `googleMapsUrl`.

## Input Example

```json
{
  "searchQueries": ["coworking London"],
  "maxResultsPerQuery": 10,
  "enrichFromWebsite": true
}
```
