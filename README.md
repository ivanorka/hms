# HMS Web

Lokalni monorepo za HMS web:

- `backend/` je Strapi 5 CMS sa SQLite bazom.
- `frontend/` je lagani frontend koji cita Strapi API, a ako Strapi nije pokrenut koristi isti lokalni seed iz `data/hms-seed.json`.
- `data/hms-seed.json` drzi navigaciju, stranice, novosti, kontakt i footer.

## Pokretanje

U ovom Codex runtimeu Node postoji bez globalnog npm-a, zato je najpouzdanije:

```bash
node scripts/start-dev.mjs
```

Frontend je na `http://localhost:5174`, Strapi admin/API na `http://localhost:1337/admin`.

Ako radis iz normalnog lokalnog Node/npm okruzenja:

```bash
npm run dev
```

## Sadrzaj

Seed sadrzi strukturu, rute, javne linkove, stranice i clanke povucene iz HMS SSR sadrzaja, uz izmjenu `Gauss d.o.o.` u `Macevalacki savez`.

Za osvjezavanje lokalnog seeda:

```bash
npm run import:hms
```

Nakon novog importa pokreni i media migraciju da se Gauss/HMS media URL-ovi prebace u lokalni Strapi Media Library:

```bash
npm run media:migrate
```

## Netlify

Netlify koristi `netlify.toml`, publish direktorij je `frontend/public`, a build kopira lokalni seed i Strapi upload assete u staticki frontend:

```bash
npm run build:netlify
```
