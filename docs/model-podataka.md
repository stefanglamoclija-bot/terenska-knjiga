# Terenska knjiga — model podataka (v1) i paket BiH

Jezgro je isto za sve zemlje. Paket zemlje (dole) određuje obrasce, koordinatni sistem, pravila i liste sredstava.
Izvor za BiH: Standard za PMA u BiH, izdanje april 2024, poglavlje 3 i prilozi (vidi `research/bih.md`).

## 1. Jezgro

Sve koordinate se čuvaju dvostruko: **lokalno** (staza, metar od startne linije, bočni pomak), kako se meri na terenu, i **u ravni koordinatnog sistema dosijea** (npr. GK zona 6). WGS84 se računa iz toga za mapu i izvoz. Izvor istine je lokalno merenje + nulta tačka + azimut.

| Entitet | Ključna polja | Napomena |
|---|---|---|
| **Organizacija** | naziv, zemlje (paketi), broj i rok akreditacije | Jedan nalog po firmi; podaci firmi su odvojeni |
| **Osoba** | ime, uloga (rukovodilac, vođa tima, deminer, medicinar, kerovođa, operater), krvna grupa, akreditacija do | Krvna grupa ide u evidenciju na radilištu |
| **Oprema** | vrsta (prsluk, vizir, detektor, mašina, pas, POEK), marka/tip, serijski broj | Za izvedbeni plan (Prilog 10) |
| **Projekat** | naziv, donator, broj ugovora, paket zemlje | npr. ITF ugovor |
| **MSP** | ID centra, naziv, općina, regionalni ured, površina km², koordinatni sistem | Minski sumnjiva površina |
| **Dosije** | ulazne tačke (Y, X, azimut, opis), prelomne tačke, karta (naziv, list, razmjer, godina), izvor dokaza, očekivana sredstva | „Crvena fascikla“ |
| **CI/SI** | tip (ciljana / sistematska istraga), naziv, površina min/max, **nulta tačka (Y, X)**, **azimut napredovanja**, poligon, širina staze, datum početka, procjena završetka, status | Jedinica rada i izvještavanja |
| **Radna staza** | CI/SI, broj, metoda, očišćeno do (m), dubina pretrage (cm) | Površina = dužina × širina staze |
| **Dvojac** | deminer A, deminer B, staza, ko je u stazi, početak smjene | Smjena najviše 30 min (BiH) |
| **Radni dan** | datum, tim, CI/SI, vođa tima, metode, m² deminerima, m² pregama, utrošeni eksploziv, CASEVAC vježba, napomena, potpis | Prilog 9 |
| **Događaj dnevnika** | vrijeme od–do, vrsta, opis, staza, veza (nalaz, KK, uništavanje) | Vrste: dolazak, brifing, test detektora, početak rada, smjena, odmor, nalaz, interna KK, uništavanje, posjeta, prekid, odlazak, nova informacija |
| **Nalaz** | CI/SI, staza, udaljenost od startne linije (m), bočni pomak (m), Y/X, lat/lon, kategorija (PP, PT, NUS, mina iznenađenja), tip, količina, dubina, stanje, postupak, fotografije, napomena, vrijeme | Prilog 13 i karta uz Prilog 6 |
| **Uništavanje** | vrijeme, nalazi, eksploziv (vrsta, kg), sigurnosna udaljenost | Dnevnik + Prilog 9 |
| **Interna KK** | datum, CI/SI, metoda, uzorak m², osoba, rezultat, mjere | Prilog 6 polja 16–17 |
| **Nesreća** | vrijeme, mjesto, Y/X + sistem, policija, sredstvo, žrtve, označenost, ranije nesreće, razlog ulaska, opis, skica, rok prijave | Prilog 12 |
| **Nova informacija** | datum, MSP, opis, izvor | Prilog 1 i 11 |
| **Završetak CI/SI** | 26 polja Priloga 6 + prilozi a–k | Predaja centru |

## 2. Paket zemlje — struktura

```json
{
  "id": "BA-BHMAC-2024",
  "naziv": "Bosna i Hercegovina · Standard za PMA u BiH (april 2024)",
  "koordinate": { "dozvoljeni": ["GK6", "UTM34"], "podrazumijevani": "GK6", "mijesanje": false },
  "pravila": {
    "sirina_staze_m": 1, "preklop_m": 0.1, "min_dubina_cm": 10,
    "smjena_max_min": 30, "razmak_dvojca_m": 25, "odmor_m": 100,
    "interna_kk_min_pct": 3, "interni_nadzor_svakih_radnih_dana": 5,
    "nesreca_rok_h": 6, "sedmicni_izvjestaj": { "dan": "ponedjeljak", "do": "16:00" },
    "izvedbeni_plan_dana_prije": 7, "masinska_povrsina_se_racuna": false
  },
  "obrasci": ["P9 Dnevni izvještaj", "P10 Izvedbeni plan", "P11 Sedmični izvještaj",
              "P12 Inicijalni izvještaj o incidentu/nesreći", "P13 Stručni izvještaj o ES",
              "P1 Obavijest o prikupljanju informacija tokom TI",
              "P6 Zapisnik o izvršenim aktivnostima TI i čišćenja CI/SI"],
  "sredstva": {
    "PP": ["PMA-1","PMA-2","PMA-3","PMR-2A","PMR-2AS","PMR-3","PMR-4","PROM-1","PMR-čp","Goraždanka"],
    "PT": ["TMM-1","TMA-1A","TMA-2A","TMA-3","TMA-4","TMA-5","TMRP-6"],
    "NUS": ["Ručna bomba","Mina za MB 60 mm","Mina za MB 82 mm","Mina za MB 120 mm","Projektil","Nepoznato"]
  },
  "unistavanje_sigurne_udaljenosti_m": { "PP fugasna": 100, "PP rasprskavajuća/odskočna": 300, "PT": "400–1000", "projektili": "do 2250" }
}
```

Paket Srbija (u pripremi): IMSMA Core + Survey123; SRB_ETRS89 / UTM 34N; dubina 20 cm; norma do 150 m² po demineru dnevno; obrasci se traže od CZRS-a.

## 3. Koordinate (paket BiH)

- **GK zona 6:** MGI 1901 / Balkans zone 6 (EPSG:3908): Bessel 1841, λ0 = 18°, k0 = 0,9999, lažni istok 6.500.000 m. Y = istok, X = sjever.
- **UTM 34N:** WGS84, λ0 = 21°, k0 = 0,9996, lažni istok 500.000 m.
- Prelaz MGI → WGS84 u demu: 3 parametra (682, −203, 480 m). **Ovo treba potvrditi s BHMAC-om.** Parametri se razlikuju po izvorima, a greška može biti nekoliko metara.
- Položaj nalaza: P = nulta tačka + (staza − 0,5 + bočno) · D + udaljenost · N, gdje je N jedinični vektor azimuta napredovanja (sin az, cos az), a D vektor udesno (cos az, −sin az). Računa se u ravni GK pa je tačno.
