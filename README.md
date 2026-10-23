# Nasza łączność

Przeglądarkowy pokój głosowy dla znajomych. To samodzielna aplikacja, nie bot ani dodatek do Discorda.

## Uruchomienie lokalne

Wymagany jest Node.js 18 lub nowszy.

```powershell
npm install
Copy-Item .env.example .env
npm start
```

W `.env` zastąp przykładowy `SESSION_SECRET` własnym losowym ciągiem. Jeśli dostawca TURN przekazał Ci dane, uzupełnij też:

```dotenv
TURN_URLS=turn:adres-serwera:3478?transport=udp,turns:adres-serwera:5349?transport=tcp
TURN_USERNAME=login-od-dostawcy
TURN_CREDENTIAL=haslo-od-dostawcy
```

Po zmianie `.env` uruchom ponownie serwer. Bez TURN aplikacja pokaże ostrzeżenie; STUN nie wystarcza w każdej parze sieci.

Otwórz `http://localhost:3000`. Najpierw wpisz swój nick, który będzie widoczny na liście w pokoju — również gdy tworzysz pokój. Utwórz pokój i podaj wygenerowany kod znajomym albo dołącz do pokoju, wpisując otrzymany kod. Uczestnicy są pogrupowani pod kanałami Supple, Support i Szturm, a generał jest pokazywany na początku swojej grupy. „Słuchacz” jest osobną rolą poza wyborem drużyny. Pokoje i kody działają do 12 godzin; restart serwera usuwa pokoje. Do testowania rozmowy użyj dwóch przeglądarek lub urządzeń. Aby mówić, wybierz rolę drużyny, włącz mikrofon przyciskiem **Włącz mikrofon** i zezwól na dostęp do mikrofonu.

W pokoju dostępny jest też czat tekstowy. Wiadomości są oznaczane drużyną i nickiem nadawcy (np. `Support: (Alex) Cześć!`), a ostatnie 100 wiadomości pokoju jest przechowywane w pamięci do czasu wygaśnięcia pokoju lub restartu serwera.

## Wdrożenie na własnym serwerze

Konfiguracja Docker Compose uruchamia aplikację za reverse proxy Caddy, które automatycznie uzyskuje certyfikat HTTPS. Potrzebujesz serwera z Dockerem i Docker Compose oraz własnej domeny. W przykładowym pliku `.env.example` ustawiono `discord-wardogs-polska.pl` jako propozycję nazwy — domena musi być wcześniej zarejestrowana i skierowana na Twój publiczny serwer. Podkreślenie w `discord_wardogs_polska.pl` nie jest poprawne dla domeny HTTPS; użyj myślnika, np. `discord-wardogs-polska.pl`.

1. Skieruj rekord DNS `A` domeny na publiczny adres IP serwera. Jeśli używasz rekordu `AAAA`, serwer musi być dostępny również przez IPv6.
2. Otwórz na serwerze porty TCP `80` i `443` oraz UDP `443` dla HTTP/3.
3. W katalogu projektu utwórz plik `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

4. W `.env` ustaw `APP_DOMAIN` na swoją domenę i `SESSION_SECRET` na losowy sekret. Wygeneruj sekret poleceniem:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Nie udostępniaj ani nie dodawaj `.env` do repozytorium.
5. Jeśli sieci uczestników blokują bezpośrednie połączenia audio, skonfiguruj w `.env` usługę TURN. Ustaw `TURN_URLS` na jeden lub kilka adresów `turn:`/`turns:` oddzielonych przecinkami, a `TURN_USERNAME` i `TURN_CREDENTIAL` na dane dostępowe otrzymane od dostawcy. Przykład:

   ```dotenv
   TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
   TURN_USERNAME=wartosc_od_dostawcy
   TURN_CREDENTIAL=wartosc_od_dostawcy
   ```

   Nie wpisuj tych danych do plików klienta ani nie publikuj ich. Konfiguracja jest udostępniana wyłącznie uczestnikom z ważną sesją pokoju, ale przeglądarka musi otrzymać dane dostępu TURN, aby zestawić połączenie. Używaj danych przeznaczonych dla klienta WebRTC, najlepiej krótkotrwałych, i sprawdź u dostawcy wymagane porty UDP/TCP. Cloudflare Tunnel nie zastępuje serwera TURN.
6. Uruchom aplikację:

   ```powershell
   docker compose up --build -d
   docker compose logs -f
   ```

7. Wejdź na `https://twoja-domena`, wpisz swój nick, utwórz pokój, skopiuj wygenerowany kod i podaj go znajomym. Znajomi wpisują swój nick, wybierają „Dołącz do pokoju” i podają ten kod. Kod jest kluczem dostępu — udostępniaj go tylko osobom, które zapraszasz.

Aktualizacja po zmianie kodu:

```powershell
docker compose up --build -d
```

Zatrzymanie:

```powershell
docker compose down
```

W trybie produkcyjnym serwer nie uruchomi się bez `SESSION_SECRET`. Sam obraz Docker można też uruchomić na innym hostingu obsługującym kontenery, ale hosting musi zapewniać HTTPS/WSS i przekazywać WebSocket.

## Reguły słyszalności

- **Supple**, **Support** i **Szturm** słyszą i mogą mówić wyłącznie do osób z tej samej drużyny oraz jej generała.
- Każdy generał rozmawia ze swoją drużyną oraz wszystkimi pozostałymi generałami.
- **Słuchacz** słyszy wszystkie drużyny i generałów, ale nie nadaje dźwięku. Wybierz rolę drużyny, aby mówić.
- Przycisk **Przytrzymaj, aby mówić** nadaje głos do wszystkich uczestników pokoju tylko podczas przytrzymania. Przycisk **Ustaw klawisz** pozwala przypisać dowolny klawisz; naciśnij go ponownie, aby go zmienić. Słuchacz nie może używać globalnego kanału.
- Lista **Mówią teraz** po prawej pokazuje osoby nadające przez globalny kanał. Zwykłe rozmowy drużynowe nadal są odtwarzane zgodnie z rolami, a globalne audio jest włączane dla odbiorców tylko na czas nadawania.
- Mikrofon można wyciszyć bez opuszczania wybranej roli.
- Przycisk **Wycisz wszystko** wyłącza jednocześnie mikrofon i odbiór dźwięku; ponowne kliknięcie przywraca poprzedni stan mikrofonu oraz ustawioną głośność.
- Przycisk **Głośność** pozwala regulować dźwięk od innych uczestników w zakresie 0–100%.
- Każdy uczestnik może użyć **Sprawdź mikrofon**, aby odtworzyć mikrofon lokalnie bez wysyłania głosu do innych. W trakcie testu nadal słyszy pozostałych uczestników. Po zakończeniu testu aplikacja przywraca poprzedni stan mikrofonu.
- Mikrofon jest wysyłany bezpośrednio do połączenia WebRTC, a dźwięk każdego uczestnika jest odtwarzany przez osobny element audio. Ta prosta ścieżka omija Web Audio API i AudioWorklet, aby ograniczyć problemy z zawieszonym kontekstem audio.

## Ograniczenia i prywatność

- Kod pokoju jest unikalnym kodem dostępu; po jego podaniu każdy uczestnik dostaje sesję ważną 12 godzin. Pokoje są przechowywane w pamięci serwera i wygasają po 12 godzinach lub po restarcie procesu.
- Podział audio jest realizowany przez przeglądarki uczestników. To prototyp dla znajomych, a nie zabezpieczenie przed złośliwym uczestnikiem. Nie używaj go do poufnych rozmów.
- Połączenia audio są peer-to-peer w modelu mesh, w tym połączenia potrzebne do globalnego kanału PTT, więc obciążenie rośnie wraz z liczbą osób. Dla większych grup potrzebny będzie serwer SFU.
- Aplikacja używa publicznego serwera STUN. Opcjonalnie można skonfigurować TURN przez zmienne `TURN_URLS`, `TURN_USERNAME` i `TURN_CREDENTIAL`. Niektóre sieci wymagają TURN; przy użyciu relay dźwięk może przechodzić przez serwer TURN wskazany przez operatora tej usługi.
- Lista uczestników i przypisane role są przechowywane w pamięci procesu. Restart serwera rozłączy osoby w pokoju; aplikacja nie zapisuje historii rozmów.
- Czat nie jest zapisywany na dysku; w pamięci pokoju przechowuje maksymalnie 100 ostatnich wiadomości i usuwa je po wygaśnięciu pokoju lub restarcie serwera.
