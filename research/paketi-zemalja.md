# Terenska knjiga — paketi zemalja: Srbija, BiH, Slovenija

Sinteza istraživanja od 2026-10-18. Detalji i izvori: [srbija.md](srbija.md), [bih.md](bih.md), [slovenija-itf.md](slovenija-itf.md).

## Zaključak ukratko

1. **BiH je prva zemlja za izgradnju.** Ovo je jedina od tri zemlje gde su obrasci javni i detaljni (BHMAC standard 2024 sa prilozima). Tu je i najveće tržište: 22 akreditovane organizacije, od toga 10 komercijalnih, i 584 deminera.
2. **Srbija je druga.** Koristi IMSMA Core i Survey123, pa je najbliža elektronskoj predaji. Obrasci nisu javni i moraju se tražiti od CZRS-a. Aktivno radi samo 2–3 operatera, a novac ide preko ITF tendera.
3. **Slovenija nije tržište za ovu aplikaciju.** Tamo nema komercijalnog razminiranja ni IMSMA-e: sve radi državna jedinica DEVNUS i evidentira u svom sistemu SPIN. Može postati kupac tek za poseban modul „EOD intervencije“, i to kao jedan državni kupac.
4. **ITF (Ljubljana) je važniji od same Slovenije.** Preko njega ide donatorski novac za čišćenje u BiH i Srbiji. Njegovi zahtevi za izveštavanje su u plaćenom tenderskom dosijeu (€102,26).
5. Nijedna zemlja nema elektronski kanal kojim firma direktno upisuje podatke u IMSMA. **Prva verzija zato pravi tačne obrasce koje centar prima**, a elektronsku predaju dodajemo gde je centar otvori (Srbija preko Survey123, BiH kad proradi BHIMSMA Core).

## Uporedni pregled

| | **BiH** | **Srbija** | **Slovenija** |
|---|---|---|---|
| Nadležni | Komisija za deminiranje + **BHMAC** | **MUP, Sektor za vanredne situacije** (akreditacija, nadzor) + **CZRS** (projekti, QA, uverenja) | **URSZR / DEVNUS** |
| Informacioni sistem | BHMAIS (stari); BHIMSMA Core u izgradnji od 2019. | **IMSMA Core** + Survey123 | SPIN (URSZR) |
| Kako firma predaje | Papir/PDF obrasci, e-mail, faks | Dokumenti po Uredbi; format nije javan | Nema firmi |
| Obrasci javni | **Da**, sa poljima | Ne | Delimično (NUS1–4, NUSA, NUSB, polja nepoznata) |
| Koordinate | UTM ili Gaus-Kriger (verovatno GK zona 6), bez mešanja | SRB_ETRS89 / UTM 34N (zvanično); sistem CZRS-a nepoznat | D96/TM (pretpostavka) |
| Komercijalni operateri | 10 (+7 NVO, +5 državnih) | 15 akreditovanih, 2–3 aktivna | 0 |
| Novac | EU (IPA III, Svetska banka), SAD, ITF, država | ITF (SAD, Koreja) + država | Državni budžet |

## Jezgro: šta aplikacija mora da beleži u svakoj zemlji

Zbir svih zahteva. Ovo programiramo jednom, bez obzira na zemlju.

**Organizacija i akreditacija**
- Osoblje po ulogama: rukovodilac, vođa tima, deminer, medicinar, vodič psa, operater mašine. Podaci za svakog: krvna grupa, akreditacija i rok važenja.
- Oprema sa serijskim brojevima: detektori, mašine, psi, zaštitna oprema.

**Zadatak i dosije**
- Hijerarhija: projekat → zadatak/MSP → CI/SI (podzadaci).
- ID zadatka koji dodeljuje centar.
- Ulazne tačke (Y/X + azimut), reper, referentna i prelomne tačke.
- Karte (naziv, list, razmer), izvor dokaza, očekivani tipovi sredstava.
- Izvedbeni plan: osoblje, oprema, metode, raspored staza, interni QC, datumi.

**Radni dan**
- Vremenski dnevnik: dolazak, test detektora na test-komadu, smene, nalazi po stazi, interni QC, uništavanje, posete.
- Površina po metodi: ručno, psi, mašina. Mašinski tretirana površina se ne računa kao očišćena.
- Učinak po demineru.
- Pomoćne evidencije: knjiga posetilaca, knjiga eksploziva, CASEVAC vežba.

**Nalaz**
- Vrsta, model, količina, koordinate, dubina, stanje, postupak, fotografije.
- Opciono evidencijski broj (Slovenija).

**Ostali zapisi**
- **Uništavanje:** plan, saglasnost, zapisnik, utrošeni eksploziv, bezbedna udaljenost.
- **Kontrola kvaliteta:** interni (metoda, uzorak m², nalazi) i eksterni nadzor.
- **Nesreća:** vreme, mesto i koordinate, sredstvo, žrtve, skica, policija, rok za prijavu.
- **Nove informacije o kontaminaciji**, prikupljene tokom rada.
- **Završetak:** zapisnik o predaji, površine po metodi, dubina, nalazi, potpisi, prilozi.

**Tehnika**
- Koordinate se čuvaju u WGS84, a pri izvozu preračunavaju u sistem zemlje.

## Paket BiH: šta tačno pravimo

**Izlazni dokumenti (obrasci iz STD pogl. 3):**

| Dokument | Prilog | Kada |
|---|---|---|
| Dnevni izvještaj | 9 | Svaki dan, na radilištu |
| Izvedbeni plan | 10 | Najmanje 7 dana pre početka |
| Sedmični izvještaj | 11 | Ponedeljak do 16:00 |
| Inicijalni izvještaj o incidentu/nesreći | 12 | **U roku od 6 sati** (aplikacija meri rok) |
| Stručni izvještaj o ES | 13 | Po potrebi, uz fotografije |
| Obavijest o prikupljanju informacija tokom TI | 1 | Uz završnu dokumentaciju |
| Zapisnik o završetku TI i čišćenja (26 polja) | 6 | Kraj zadatka, sa kartom 1:1000 i prilozima |

**Pravila koja aplikacija proverava:**
- Staza 1 m + 10 cm preklopa; minimalna dubina 10 cm.
- Razmak između parova 25 m; parking, medicinar i kontrolna tačka na 100 m.
- Interni QC najmanje 3%; interni nadzor najmanje svakih 5 radnih dana.
- Koordinate ili UTM ili GK, nikad oba u istom dokumentu.
- Mašinska površina se ne računa kao očišćena.

**Lista sredstava:** PMA-1/2/3, PMR-2A/2AS/3/4, PROM-1, PMR-čp, „Goraždanka“, TMM-1, TMA-1A/2A/3/4/5, TMRP-6, NUS.

**Otvoreno:**
- Tačan datum i EPSG za GK zonu 6.
- Word verzije obrazaca.
- Kako izgleda popunjen primer.

## Paket Srbija: šta znamo i šta fali

**Izlazni dokumenti po Uredbi 70/2013:**
- izvođački plan;
- zahtev za uvođenje u posao (najmanje 10 dana pre);
- izveštaj o izviđanju;
- izveštaj o obeležavanju;
- plan i zapisnik o uništavanju;
- zapisnik o predaji očišćene površine;
- završni izveštaj;
- dnevna evidencija učinka po demineru.

**Pravila:** dubina 20 cm; norma do 150 m² po demineru dnevno.

**Fali:**
- Survey123/IMSMA Core obrasci CZRS-a;
- primer projekta;
- koordinatni sistem;
- širina staze i bezbedne udaljenosti (verovatno IMAS + SOP operatera).

## Slovenija i ITF

- **Slovenija:** zasad je preskačemo. Kasnije je moguć modul „EOD intervencije“ (pojedinačni nalazi, identifikacioni list, evidencijski broj, obavezne fotografije), koji bi koristio i BiH (poglavlje 5, EOD) i MUP Srbije.
- **ITF:** izvođač na ITF ugovoru predaje izveštaje i nacionalnom centru i ITF-u. Kad dobijemo ITF dosije, dodajemo „donatorski izveštaj“ kao još jedan šablon. Podaci su isti, menja se samo izlaz.

## Sledeći koraci

**Moj deo:**
1. Model podataka jezgra (gornja lista) i plan arhitekture.
2. Paket BiH: generisanje PDF-ova koji izgledaju kao BHMAC prilozi 9, 10, 11, 12, 13, 1 i 6.
3. Demo v2 na primeru zadatka iz BiH: CI/SI, ulazne tačke sa azimutom, staze od 1 m, nalaz po metru, dnevni i sedmični izveštaj, odbrojavanje roka od 6 sati za prijavu nesreće.

**Tvoj deo:**
1. **BiH:** javi se 1–2 komercijalne firme sa BHMAC spiska za pilot. Traži popunjen primer dnevnog i sedmičnog izveštaja i zapisnika o završetku, sa zamagljenim podacima.
2. **Srbija:** pošalji mejl CZRS-u (czrs@czrs.gov.rs) i traži definicije Survey123/IMSMA Core obrazaca i primer projekta. Paralelno pitaj IN Demining ili Stop Mines koje obrasce predaju.
3. **ITF:** odluči da li da kupimo jedan tenderski dosije (€102), ili da ga tražimo od firme koja je već radila na ITF ugovoru.
