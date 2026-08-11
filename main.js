/* ============================================
   القرآن الكريم — Quran Website JavaScript
   ============================================ */

function apiFetch(url, options = {}) {
    return fetch(url, {
        credentials: 'include', // ✅ أهم سطر
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });
}

// ===== iOS Detection =====
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ===== SPA Navigation for iOS (fixes audio autoplay after navigation) =====
async function navigateToSurah(surahNumber, options = {}) {
    const { reciter, autoNext, autoplay } = options;

    // Non-iOS: keep original behavior
    if (!isIOS()) {
        let url = `/surah/${surahNumber}`;
        const params = new URLSearchParams();
        if (autoplay) params.set('autoplay', 'full');
        if (autoNext) params.set('autoNext', '1');
        if (reciter) params.set('reciter', reciter);
        if (params.toString()) url += '?' + params.toString();
        window.location.href = url;
        return;
    }

    // iOS: load via fetch without leaving the page
    try {
        // Stop current audio to clean state
        const audio = document.getElementById('audioElement');
        if (audio) {
            audio.pause();
            audio.src = '';
        }
        hideAudioPlayer();
        updatePlayIcon(false);
        isPlayingFullSurah = false;
        playMode = 'full';
        currentPlayingVerseBtn = null;
        if (currentHighlightedVerse) {
            currentHighlightedVerse.classList.remove('active-verse', 'active-verse-glow');
            currentHighlightedVerse = null;
        }

        const res = await apiFetch(`/api/surahs/${surahNumber}`);
        const data = await res.json();
        if (!data.success) throw new Error('Failed to load surah');

        const surah = data.surah;
        const verses = data.verses;

        // Update URL
        let url = `/surah/${surahNumber}`;
        const urlParams = new URLSearchParams();
        if (autoplay) urlParams.set('autoplay', 'full');
        if (autoNext) urlParams.set('autoNext', '1');
        if (reciter) urlParams.set('reciter', reciter);
        if (urlParams.toString()) url += '?' + urlParams.toString();
        history.pushState({ surahNumber }, '', url);

        // Rebuild page DOM
        reinitSurahPage(surah, verses);

        // Autoplay if requested (direct call inside user-gesture chain)
        if (autoplay) {
            // ✅ Set full-surah state so prev/next buttons keep working
            isPlayingFullSurah = true;
            playMode = 'full';
            buildVersesList();

            // ✅ Show full-surah controls
            const repeatSurahBtn = document.getElementById('repeatSurahBtn');
            const autoNextSurahBtn = document.getElementById('autoNextSurahBtn');
            if (repeatSurahBtn) repeatSurahBtn.style.display = '';
            if (autoNextSurahBtn) autoNextSurahBtn.style.display = '';

            // ✅ Hide verse-sequence controls
            const sequenceBtn = document.getElementById('playSequenceBtn');
            const repeatBtn = document.getElementById('repeatVerseBtn');
            if (sequenceBtn) sequenceBtn.classList.remove('active');
            if (repeatBtn) {
                repeatBtn.classList.remove('active');
                repeatBtn.style.display = 'none';
            }

            playAudio(surahNumber, 0, `سورة ${surah.name}`);
        }
    } catch (err) {
        console.error('SPA navigation failed:', err);
        // Fallback to full reload
        let url = `/surah/${surahNumber}`;
        const urlParams = new URLSearchParams();
        if (autoplay) urlParams.set('autoplay', 'full');
        if (autoNext) urlParams.set('autoNext', '1');
        if (reciter) urlParams.set('reciter', reciter);
        if (urlParams.toString()) url += '?' + urlParams.toString();
        window.location.href = url;
    }
}

function reinitSurahPage(surah, verses) {
    // Update global vars
    window.currentSurah = surah.surah_number;
    window.surahName = `سورة ${surah.name}`;
    window.totalVerses = surah.verses_count;
    window.prevSurah = surah.surah_number > 1 ? surah.surah_number - 1 : null;
    window.nextSurah = surah.surah_number < 114 ? surah.surah_number + 1 : null;
    window.initialLoadedVerses = 50;
    window.loadedVersesCount = 50;
    window.allVersesLoaded = verses.length <= 50;
    window.targetVerse = 0;
    isLoadingMoreVerses = false;

    // Update title
    document.title = `سورة ${surah.name} — القرآن الكريم`;

    // Update header title
    const titleEl = document.querySelector('.surah-title');
    if (titleEl) titleEl.textContent = `سورة ${surah.name}`;

    // Update transliteration
    const transEl = document.querySelector('.surah-title-en');
    if (transEl) transEl.textContent = surah.name_transliteration || '';

    // Update meta
    const metaEl = document.querySelector('.surah-header-meta');
    if (metaEl) {
        const revType = surah.revelation_type === 'مكية' ? 'makkah' : 'madinah';
        metaEl.innerHTML = `
            <span class="revelation-badge ${revType}">
                ${surah.revelation_type}
            </span>
            <span class="verses-count-badge">
                <i class="fas fa-book"></i>
                عدد الآيات: ${surah.verses_count}
            </span>
        `;
    }

    // Update play full button
    const playFullBtn = document.getElementById('playFullSurah');
    if (playFullBtn) {
        playFullBtn.dataset.surah = surah.surah_number;
    }

    // Update favorite button
    const favBtn = document.querySelector('.fav-star-large');
    if (favBtn) {
        favBtn.dataset.surahId = surah.id;
        favBtn.classList.toggle('active', surah.is_favorite);
        const icon = favBtn.querySelector('i');
        if (icon) icon.className = surah.is_favorite ? 'fas fa-star' : 'far fa-star';
        favBtn.title = surah.is_favorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة';
    }

    // Update nav links (full rebuild with correct names from API)
    const navContainer = document.querySelector('.surah-nav');
    if (navContainer) {
        const existingBack = navContainer.querySelector('.back-link');
        navContainer.innerHTML = '';
        if (existingBack) navContainer.appendChild(existingBack);

        // Fetch prev/next surah names then build links
        const fetchSurahName = async (num) => {
            if (!num) return null;
            try {
                const res = await apiFetch(`/api/surahs/${num}`);
                const data = await res.json();
                return data.success ? data.surah.name : null;
            } catch (e) { return null; }
        };

        Promise.all([
            fetchSurahName(window.prevSurah),
            fetchSurahName(window.nextSurah)
        ]).then(([prevName, nextName]) => {
            if (window.prevSurah && prevName) {
                const a = document.createElement('a');
                a.href = '#';
                a.className = 'nav-surah-link';
                a.innerHTML = `<i class="fas fa-chevron-right"></i> ${prevName}`;
                a.onclick = (e) => {
                    e.preventDefault();
                    navigateToSurah(window.prevSurah, { reciter: getReciterId(), autoNext: autoNextSurahEnabled });
                };
                navContainer.appendChild(a);
            }
            if (window.nextSurah && nextName) {
                const a = document.createElement('a');
                a.href = '#';
                a.className = 'nav-surah-link';
                a.innerHTML = `${nextName} <i class="fas fa-chevron-left"></i>`;
                a.onclick = (e) => {
                    e.preventDefault();
                    navigateToSurah(window.nextSurah, { reciter: getReciterId(), autoNext: autoNextSurahEnabled });
                };
                navContainer.appendChild(a);
            }
        });
    }

    // Rebuild verses container (first 50)
    const container = document.getElementById('versesContainer');
    if (container) {
        container.innerHTML = verses.slice(0, 50).map(v => renderVerse(v)).join('');
        loadedVersesCount = Math.min(50, verses.length);
    }

    // Reset lazy loading observer
    const trigger = document.getElementById('loadMoreTrigger');
    if (trigger && window.lazyLoadObserver) {
        window.lazyLoadObserver.disconnect();
        window.lazyLoadObserver.observe(trigger);
    }

    // Reset search panel
    const searchPanel = document.getElementById('surahSearchPanel');
    const searchInput = document.getElementById('surahSearchInput');
    const searchInfo = document.getElementById('surahSearchInfo');
    if (searchPanel) searchPanel.style.display = 'none';
    if (searchInput) {
        searchInput.value = '';
        searchInput.disabled = false;
    }
    if (searchInfo) {
        searchInfo.style.display = 'none';
        searchInfo.textContent = '';
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}



// ===== Toast Notifications =====
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ===== Dark Mode =====
function initDarkMode() {

    const toggle =
        document.getElementById('darkModeToggle');

    const icon =
        document.getElementById('darkModeIcon');

    const html =
        document.documentElement;

    if (!toggle || !icon) return;


    // ✅ الأوضاع المتاحة
    const themes = [
        'light',
        'dark',
        'emerald'
    ];


    // ✅ تطبيق الثيم
    function applyTheme(theme) {

        // تنظيف الحالات القديمة
        html.classList.remove('dark');
        html.removeAttribute('data-theme');

        if (theme === 'dark') {

            html.classList.add('dark');
            html.setAttribute('data-theme', 'dark');

            icon.className = 'fas fa-moon';

            toggle.title = 'الوضع الداكن';

        } else if (theme === 'emerald') {

            html.setAttribute('data-theme', 'emerald');

            icon.className = 'fas fa-gem';

            toggle.title = 'الوضع الأخضر';

        } else {

            icon.className = 'fas fa-sun';

            toggle.title = 'الوضع الفاتح';
        }

        localStorage.setItem(
            'quran-theme',
            theme
        );
    }


    // ✅ قراءة الثيم المحفوظ
    let savedTheme =
        localStorage.getItem('quran-theme');


    // ✅ توافق مع النظام القديم quran-dark-mode
    if (!savedTheme) {

        const oldDarkMode =
            localStorage.getItem('quran-dark-mode');

        if (oldDarkMode === 'true') {
            savedTheme = 'dark';
        } else {
            savedTheme = 'light';
        }
    }


    // ✅ لو القيمة غير صحيحة
    if (!themes.includes(savedTheme)) {
        savedTheme = 'light';
    }


    applyTheme(savedTheme);


    // ✅ عند الضغط: يلف بين 3 أوضاع
    toggle.addEventListener('click', () => {

        const currentTheme =
            localStorage.getItem('quran-theme') || 'light';

        const currentIndex =
            themes.indexOf(currentTheme);

        const nextTheme =
            themes[
                (currentIndex + 1) % themes.length
            ];

        applyTheme(nextTheme);
    });
}

// ===== Mobile Menu =====
function initMobileMenu() {
    const btn = document.getElementById('mobileMenuBtn');
    const menu = document.getElementById('mobileMenu');
    if (!btn || !menu) return;

    btn.addEventListener('click', () => {
        menu.classList.toggle('show');
        const icon = btn.querySelector('i');
        icon.className = menu.classList.contains('show') ? 'fas fa-times' : 'fas fa-bars';
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('show');
            btn.querySelector('i').className = 'fas fa-bars';
        }
    });
}

// ===== Search =====
function initSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    if (!searchInput) return;

    let debounceTimer;

    function performSearch() {
        const query = searchInput.value.trim();
        if (query) {
            window.location.href = `/?q=${encodeURIComponent(query)}`;
        }
    }

    // Client-side filtering (no page reload)
    const surahsContainer = document.getElementById('surahsContainer');
    if (surahsContainer) {
        const cards = surahsContainer.querySelectorAll('.surah-card');

        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const query = searchInput.value.trim().toLowerCase();

                cards.forEach(card => {
                    const name = (card.dataset.name || '').toLowerCase();
                    const en = (card.dataset.en || '').toLowerCase();
                    const trans = (card.dataset.trans || '').toLowerCase();
                    const number = (card.dataset.number || '');

                    if (!query || name.includes(query) || en.includes(query) || trans.includes(query) || number === query) {
                        card.style.display = '';
                    } else {
                        card.style.display = 'none';
                    }
                });

                // Show no results message
                let noResults = document.getElementById('noResultsMsg');
                const visible = Array.from(cards).filter(c => c.style.display !== 'none');

                if (visible.length === 0 && query) {
                    if (!noResults) {
                        noResults = document.createElement('div');
                        noResults.id = 'noResultsMsg';
                        noResults.className = 'no-results';
                        noResults.innerHTML = `
                            <i class="fas fa-search no-results-icon"></i>
                            <p class="no-results-text">لا توجد نتائج للبحث: "${searchInput.value}"</p>
                        `;
                        surahsContainer.parentNode.appendChild(noResults);
                    }
                    noResults.style.display = '';
                } else if (noResults) {
                    noResults.style.display = 'none';
                }
            }, 300);
        });
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', performSearch);
    }

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
}

// ===== Favorites =====
function toggleFavorite(button, type = 'surah') {
    const surahId = button.dataset.surahId;
    const verseId = button.dataset.verseId || null;

    if (!isLoggedIn()) {
        showToast('يرجى تسجيل الدخول أولاً', 'info');
        setTimeout(() => {
            window.location.href = '/login';
        }, 1500);
        return;
    }

    apiFetch('/api/favorites', {
        method: 'POST',
        body: JSON.stringify({
            surah_id: parseInt(surahId),
            verse_id: verseId ? parseInt(verseId) : null
        })
    })
    .then(r => r.json())
    .then(data => {
        if (!data.success) {
            showToast(data.message || 'حدث خطأ', 'error');
            return;
        }

        const icon = button.querySelector('i');

        if (data.added) {
            button.classList.add('active');
            if (icon) icon.className = 'fas fa-star';
            showToast(data.message, 'success');
        } else {
            button.classList.remove('active');
            if (icon) icon.className = 'far fa-star';
            showToast(data.message, 'info');

            // إزالة العنصر من صفحة المفضلة
            if (window.location.pathname === '/favorites') {
                const card = button.closest('.surah-card, .verse-item');
                if (card) {
                    card.style.transition = 'opacity 0.3s, transform 0.3s';
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(-10px)';
                    setTimeout(() => {
                        card.remove();
                        const container = document.querySelector('.surahs-container, .verses-list');
                        if (container && container.children.length === 0) {
                            location.reload();
                        }
                    }, 300);
                }
            }
        }

        // Animation
        button.style.transform = 'scale(1.3)';
        setTimeout(() => {
            button.style.transform = '';
        }, 200);
    })
    .catch(err => {
        console.error('Favorite error:', err);
        showToast('حدث خطأ في الاتصال', 'error');
    });
}


function initFavorites() {

    document.addEventListener('click', (e) => {

        const btn = e.target.closest(
            '.fav-star, .fav-star-large, .fav-btn-verse'
        );

        if (!btn) return;

        e.preventDefault();
        e.stopPropagation();

        const type =
            btn.classList.contains('fav-btn-verse')
                ? 'verse'
                : 'surah';

        toggleFavorite(
            btn,
            type
        );

    });
}

// ===== Check Login Status =====
function isLoggedIn() {
    return document.body.dataset.loggedIn === 'true';
}

// ===== Audio Player =====
let currentAudio = null;
let currentVerseIndex = 0;
let versesList = [];
let isPlayingFullSurah = false;
let currentReciterId = '3'; // Default: Al-Afasy
let currentPlayingVerseBtn = null;

let playMode = 'full';
// 'full' = سورة كاملة
// 'ayah' = آية واحدة
// 'sequence' = آية آية + تكرار

// ===== Verse Repeat (Tahfeez Mode) =====

let repeatEnabled = false;
let repeatCount = 0;
let repeatTimes = 3; // عدد مرات تكرار الآية

// ===== Full Surah Repeat / Auto Next =====

let repeatSurahEnabled = false;
let autoNextSurahEnabled = false;

// --------- highlight ----------

let currentHighlightedVerse = null;

function highlightVerse(verseNumber) {

    // إزالة التحديد السابق
    if (currentHighlightedVerse) {

        currentHighlightedVerse.classList.remove(
            'active-verse',
            'active-verse-glow'
        );
    }

    const el = document.querySelector(
        `.verse-item[data-verse-number="${verseNumber}"]`
    );

    // ✅ الآية غير موجودة حالياً في DOM
    if (!el) {

        currentHighlightedVerse = null;

        return false;
    }

    el.classList.add(
        'active-verse',
        'active-verse-glow'
    );

    el.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });

    currentHighlightedVerse = el;

    return true;
}



function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function showAudioPlayer() {
    const player = document.getElementById('audioPlayer');
    if (player) player.style.display = '';
}

function hideAudioPlayer() {
    const player = document.getElementById('audioPlayer');
    if (player) player.style.display = 'none';
}

function updatePlayIcon(isPlaying) {
    const icon = document.getElementById('playPauseIcon');
    if (icon) icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
}

function getReciterId() {
    // Get from dropdown first, fallback to currentReciterId, fallback to first option
    const reciterSelect = document.getElementById('reciterSelect');
    if (reciterSelect && reciterSelect.value) {
        return reciterSelect.value;
    }
    if (currentReciterId) {
        return currentReciterId;
    }
    // Default: Al-Afasy (id=3)
    return '3';
}

// Store fallback URL for error recovery
let pendingFallbackUrl = null;


function playAudio(surahNumber, verseNumber, surahName) {
    showAudioPlayer();

    const audio = document.getElementById('audioElement');

    // ✅ لو المستخدم وقف الصوت من المشغّل السفلي
    audio.onpause = () => {
        // لو الوقوف مش بسبب انتهاء الصوت
        if (!audio.ended && currentPlayingVerseBtn) {
            currentPlayingVerseBtn.innerHTML = '<i class="fas fa-play"></i>';
            currentPlayingVerseBtn = null;
            updatePlayIcon(false);
        }
    };

    const titleEl = document.getElementById('audioTitle');
    const progressBar = document.getElementById('progressBar');
    const reciterId = getReciterId();

    // Reset state
    audio.pause();
    audio.src = '';
    pendingFallbackUrl = null;

    // العنوان
    if (titleEl) {
        titleEl.textContent = surahName
            ? `${surahName} - آية ${verseNumber}`
            : `آية ${verseNumber}`;
    }

    const apiUrl =
        `/api/audio/${surahNumber}/${verseNumber}?reciter=${reciterId}`;

    apiFetch(apiUrl)
        .then(r => r.json())
        .then(data => {

            if (!data.success || !data.audio_url) {
                showToast(
                    data.message || 'تعذر تحميل الملف الصوتي',
                    'error'
                );

                updatePlayIcon(false);
                return;
            }

            audio.src = data.audio_url;

            audio.play()
                .then(() => {

                    updatePlayIcon(true);

                    // ✅ Highlight الآية الحالية
                    highlightVerse(verseNumber);

                    // ✅ رجّع أي زر آية كان شغال قبل كده لـ ▶️
                    if (currentPlayingVerseBtn) {
                        currentPlayingVerseBtn.innerHTML =
                            '<i class="fas fa-play"></i>';
                    }

                    // ✅ زر الآية الحالية يتحول ⏸️
                    const btn = document.querySelector(
                        `.play-verse-btn[data-verse="${verseNumber}"]`
                    );

                    if (btn) {
                        btn.innerHTML =
                            '<i class="fas fa-pause"></i>';

                        currentPlayingVerseBtn = btn;
                    }
                })
                .catch(err => {

                    console.error('Audio play error:', err);

                    showToast(
                        'تعذر تشغيل الصوت، جرب قارئاً آخر',
                        'error'
                    );

                    updatePlayIcon(false);
                });

        })
        .catch(err => {

            console.error('Audio API error:', err);

            showToast(
                'تعذر الاتصال بخادم الصوت',
                'error'
            );

            updatePlayIcon(false);
        });

    // تحديث التقدم
    audio.ontimeupdate = () => {

        if (!audio.duration) return;

        const percent =
            (audio.currentTime / audio.duration) * 100;

        if (progressBar) {
            progressBar.value = percent;
        }

        const timeEl =
            document.getElementById('audioTime');

        if (timeEl) {
            timeEl.textContent =
                `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
        }
    };

    // نهاية الصوت
    audio.onended = () => {

        // ✅ وضع آية واحدة
        if (playMode === 'ayah') {

            if (
                repeatEnabled &&
                repeatCount < repeatTimes - 1
            ) {
                repeatCount++;
                audio.currentTime = 0;
                audio.play();
                return;
            }

            repeatCount = 0;
            return;
        }

        // ✅ وضع آية بآية
        if (playMode === 'sequence') {

            if (
                repeatEnabled &&
                repeatCount < repeatTimes - 1
            ) {
                repeatCount++;
                audio.currentTime = 0;
                audio.play();
                return;
            }

            repeatCount = 0;

            if (currentVerseIndex < versesList.length - 1) {

                currentVerseIndex++;

                playAudio(
                    window.currentSurah,
                    versesList[currentVerseIndex],
                    window.surahName
                );
            }

            return;
        }

        // ✅ وضع سورة كاملة
        if (playMode === 'full') {

            // ✅ تكرار نفس السورة
            if (repeatSurahEnabled) {

                audio.currentTime = 0;
                audio.play();

                return;
            }

            // ✅ تشغيل السورة التالية تلقائيًا
            if (autoNextSurahEnabled) {

                if (window.nextSurah) {

                    // ✅ نحافظ على نفس القارئ المختار
                    const selectedReciter =
                        getReciterId();

                    navigateToSurah(
                        window.nextSurah,
                        { autoplay: true, autoNext: true, reciter: selectedReciter }
                    );

                } else {

                    showToast(
                        'هذه آخر سورة',
                        'info'
                    );
                }

                return;
            }

            return;
        }
    };
}


function tryFallback(audio, surahName, verseNumber) {
    if (pendingFallbackUrl) {
        audio.src = pendingFallbackUrl;
        audio.play().then(() => {
            updatePlayIcon(true);
            showToast('يتم التشغيل من المصدر البديل (صوت السورة كاملة)', 'info');
        }).catch(err => {
            console.error('Fallback play error:', err);
            showToast('تعذر تشغيل الصوت، جرب قارئاً آخر', 'error');
            updatePlayIcon(false);
        });
        pendingFallbackUrl = null;
    } else {
        showToast('تعذر تشغيل الصوت، جرب قارئاً آخر', 'error');
        updatePlayIcon(false);
    }
}

function togglePlayPause() {
    const audio = document.getElementById('audioElement');
    if (!audio.src) return;

    if (audio.paused) {
        audio.play();
        updatePlayIcon(true);
    } else {
        audio.pause();
        updatePlayIcon(false);
    }
}


function toggleVerseRepeat() {

    repeatEnabled = !repeatEnabled;
    repeatCount = 0;

    // ✅ زر تكرار الآية فقط
    const btn = document.getElementById('repeatVerseBtn');

    if (btn) {
        btn.classList.toggle('active', repeatEnabled);
    }

    // ✅ الرسالة العادية فقط
    showToast(
        repeatEnabled
            ? '🔁 تم تفعيل تكرار الآية'
            : '⏹ تم إيقاف تكرار الآية',

        repeatEnabled ? 'success' : 'info'
    );
}



// ✅ إخفاء / إظهار الآية
function toggleVerse(id, btn) {

    // ✅ نجيب العنصر الأب (verse-item) عن طريق data-verse-id
    const container = document.querySelector(
        `.verse-item[data-verse-id="${id}"]`
    );

    // ✅ نجيب النص فقط
    const verse = container?.querySelector(".verse-text");

    // ✅ زر العين
    const eye = btn.querySelector(".eye");

    if (!verse) return;

    const isHidden = verse.style.opacity === "0";

    if (isHidden) {
        // ✅ يظهر
        verse.style.opacity = "1";
        if (eye) eye.classList.add("open");
    } else {
        // ✅ يختفي (النص بس)
        verse.style.opacity = "0";
        if (eye) eye.classList.remove("open");
    }
}

// ===== Tafsir Selector =====

const TAFSIR_OPTIONS = [
    {
        id: 'ar.muyassar',
        name: 'الميسر'
    },
    {
        id: 'ar.jalalayn',
        name: 'الجلالين'
    },
    {
        id: 'ar.waseet',
        name: 'الوسيط'
    },
    {
        id: 'ar.qurtubi',
        name: 'القرطبي'
    },
    {
        id: 'ar.baghawi',
        name: 'البغوي'
    }
];

function getSavedTafsirEdition() {
    return localStorage.getItem('selected_tafsir_edition') || 'ar.muyassar';
}

function saveTafsirEdition(edition) {
    localStorage.setItem('selected_tafsir_edition', edition);
}

function renderTafsirLayout(tafsirBox, selectedEdition) {

    const buttonsHtml = TAFSIR_OPTIONS.map(option => {

        const activeClass =
            option.id === selectedEdition
                ? 'active'
                : '';

        return `
            <button type="button"
                    class="tafsir-tab ${activeClass}"
                    data-tafsir="${option.id}">
                ${option.name}
            </button>
        `;

    }).join('');

    tafsirBox.innerHTML = `
        <div class="tafsir-header">
            <span class="tafsir-title">
                التفسير
            </span>

            <div class="tafsir-tabs">
                ${buttonsHtml}
            </div>
        </div>

        <div class="tafsir-content">
            جاري تحميل التفسير...
        </div>
    `;
}

async function loadTafsirText(verseItem, tafsirBox, edition) {

    const contentEl =
        tafsirBox.querySelector('.tafsir-content');

    if (!contentEl) return;

    contentEl.innerHTML =
        'جاري تحميل التفسير...';

    const playBtn =
        verseItem.querySelector('.play-verse-btn');

    if (!playBtn) {
        contentEl.innerHTML =
            'تعذر تحديد رقم الآية';
        return;
    }

    const surahNumber =
        playBtn.dataset.surah;

    const verseNumber =
        playBtn.dataset.verse;

    try {

        const response = await fetch(
            `/api/tafsir/${surahNumber}/${verseNumber}?edition=${encodeURIComponent(edition)}`
        );

        const data = await response.json();

        if (!data.success) {
            contentEl.innerHTML =
                data.message || 'تعذر تحميل التفسير';
            return;
        }

       contentEl.innerHTML =
            formatTafsirText(data.text);

    } catch (error) {

        console.error(error);

        contentEl.innerHTML =
            'تعذر تحميل التفسير';
    }
}

function attachTafsirTabEvents(verseItem, tafsirBox) {

    const tabs =
        tafsirBox.querySelectorAll('.tafsir-tab');

    tabs.forEach(tab => {

        tab.addEventListener('click', async () => {

            const selectedEdition =
                tab.dataset.tafsir;

            saveTafsirEdition(selectedEdition);

            tabs.forEach(t => {
                t.classList.remove('active');
            });

            tab.classList.add('active');

            await loadTafsirText(
                verseItem,
                tafsirBox,
                selectedEdition
            );
        });
    });
}


function formatTafsirText(text) {

    if (!text) return '';

    return text
        // مسافة بعد علامات الوقف لو مش موجودة
        .replace(/([.!؟؛،:])(?=\S)/g, '$1 ')

        // فاصل فقرة بعد النقطة أو علامة السؤال أو الفاصلة المنقوطة
        .replace(/([.؟؛])\s+/g, '$1</p><p>')

        // بداية ونهاية الفقرات
        .replace(/^/, '<p>')
        .replace(/$/, '</p>');
}


async function toggleTafsir(button) {

    const verseItem =
        button.closest('.verse-item');

    if (!verseItem) return;

    const tafsirBox =
        verseItem.querySelector('.tafsir-box');

    if (!tafsirBox) return;

    // ✅ لو مفتوح → اقفل
    if (tafsirBox.classList.contains('show')) {

        tafsirBox.classList.remove('show');

        button.innerText =
            'عرض التفسير';

        return;
    }

    // ✅ افتح
    tafsirBox.classList.add('show');

    button.innerText =
        'إخفاء التفسير';

    const selectedEdition =
        getSavedTafsirEdition();

    renderTafsirLayout(
        tafsirBox,
        selectedEdition
    );

    attachTafsirTabEvents(
        verseItem,
        tafsirBox
    );

    await loadTafsirText(
        verseItem,
        tafsirBox,
        selectedEdition
    );
}



function updateTahfeezToolsForReciter(identifier) {

    const sequenceBtn =
        document.getElementById('playSequenceBtn');

    const repeatBtn =
        document.getElementById('repeatVerseBtn');

    const isFullOnlyReciter =
        identifier === 'Qatami' ||
        identifier === 'FULL_Hazem_Seif';

    if (isFullOnlyReciter) {

        // ✅ إخفاء تشغيل آية بآية
        if (sequenceBtn) {
            sequenceBtn.classList.remove('active');
            sequenceBtn.style.display = 'none';
        }

        // ✅ إخفاء تكرار الآية
        if (repeatBtn) {
            repeatBtn.classList.remove('active');
            repeatBtn.style.display = 'none';
        }

        // ✅ إيقاف التكرار
        repeatEnabled = false;
        repeatCount = 0;

        // ✅ لو كان وضع آية بآية شغال، نرجعه للوضع العادي
        if (playMode === 'sequence') {
            playMode = 'full';

            const audio =
                document.getElementById('audioElement');

            if (audio) {
                audio.pause();
                audio.src = '';
            }

            if (currentPlayingVerseBtn) {
                currentPlayingVerseBtn.innerHTML =
                    '<i class="fas fa-play"></i>';

                currentPlayingVerseBtn = null;
            }

            updatePlayIcon(false);
            hideAudioPlayer();
        }

    } else {

        // ✅ أي قارئ غير القطامي وحازم: نرجع زر تشغيل آية بآية
        if (sequenceBtn) {
            sequenceBtn.style.display = '';
        }

        // ✅ زر تكرار الآية يظهر فقط لو آية بآية مفعّل
        if (repeatBtn) {
            const sequenceActive =
                sequenceBtn &&
                sequenceBtn.classList.contains('active');

            repeatBtn.style.display =
                sequenceActive ? '' : 'none';
        }
    }
}



function buildVersesList() {

    versesList = [];

    for (
        let i = 1;
        i <= window.totalVerses;
        i++
    ) {
        versesList.push(i);
    }
}


function initAudioPlayer() {

    const playPauseBtn = document.getElementById('playPauseBtn');
    const closeBtn = document.getElementById('closeAudioPlayer');
    const progressBar = document.getElementById('progressBar');
    const reciterSelect = document.getElementById('reciterSelect');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    // ✅ أزرار تكرار السورة والتشغيل التلقائي
    const repeatSurahBtn =
        document.getElementById('repeatSurahBtn');

    const autoNextSurahBtn =
        document.getElementById('autoNextSurahBtn');

    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', togglePlayPause);
    }

    // ✅ زر تكرار السورة
    if (repeatSurahBtn) {

        repeatSurahBtn.addEventListener('click', () => {

            repeatSurahEnabled = !repeatSurahEnabled;

            // ✅ لو فعلنا تكرار السورة، نقفل التشغيل التلقائي
            if (repeatSurahEnabled) {

                autoNextSurahEnabled = false;

                if (autoNextSurahBtn) {
                    autoNextSurahBtn.classList.remove('active');
                }
            }

            repeatSurahBtn.classList.toggle(
                'active',
                repeatSurahEnabled
            );

            showToast(
                repeatSurahEnabled
                    ? '🔁 تم تفعيل تكرار السورة'
                    : '⏹ تم إيقاف تكرار السورة',

                repeatSurahEnabled ? 'success' : 'info'
            );
        });
    }

    // ✅ زر تشغيل السورة التالية تلقائيًا
    if (autoNextSurahBtn) {

        autoNextSurahBtn.addEventListener('click', () => {

            autoNextSurahEnabled = !autoNextSurahEnabled;

            // ✅ لو فعلنا التشغيل التلقائي، نقفل تكرار السورة
            if (autoNextSurahEnabled) {

                repeatSurahEnabled = false;

                if (repeatSurahBtn) {
                    repeatSurahBtn.classList.remove('active');
                }
            }

            autoNextSurahBtn.classList.toggle(
                'active',
                autoNextSurahEnabled
            );

            showToast(
                autoNextSurahEnabled
                    ? '▶️ تم تفعيل تشغيل السورة التالية تلقائيًا'
                    : '⏹ تم إيقاف التشغيل التلقائي',

                autoNextSurahEnabled ? 'success' : 'info'
            );
        });
    }

    if (closeBtn) {

        closeBtn.addEventListener('click', () => {

            const audio =
                document.getElementById('audioElement');

            if (audio) {
                audio.pause();
                audio.src = '';
            }

            hideAudioPlayer();

            isPlayingFullSurah = false;
            playMode = 'full';

            // ✅ إيقاف حالات السورة الكاملة عند إغلاق المشغل
            repeatSurahEnabled = false;
            autoNextSurahEnabled = false;

            if (repeatSurahBtn) {
                repeatSurahBtn.classList.remove('active');
            }

            if (autoNextSurahBtn) {
                autoNextSurahBtn.classList.remove('active');
            }

            updatePlayIcon(false);
        });
    }

    if (progressBar) {

        progressBar.addEventListener('input', (e) => {

            const audio =
                document.getElementById('audioElement');

            if (audio.duration) {

                audio.currentTime =
                    (e.target.value / 100) * audio.duration;
            }
        });
    }

    if (reciterSelect) {

        reciterSelect.addEventListener('change', (e) => {

            currentReciterId = e.target.value;

            const selectedOption =
                e.target.options[e.target.selectedIndex];

            const selectedIdentifier =
                selectedOption?.dataset?.identifier;

            if (selectedIdentifier) {

                document
                    .querySelectorAll('.reciter-btn')
                    .forEach(b => {

                        b.classList.toggle(
                            'active',
                            b.dataset.identifier === selectedIdentifier
                        );
                    });

                // ✅ تحديث أدوات آية بآية حسب القارئ المختار من القائمة
                updateTahfeezToolsForReciter(selectedIdentifier);
            }
        });
    }

    // ✅ تشغيل السورة كاملة فقط
    const playFullBtn =
        document.getElementById('playFullSurah');

    if (playFullBtn) {

        playFullBtn.addEventListener('click', () => {

            const surahNumber =
                parseInt(playFullBtn.dataset.surah);

            buildVersesList();

            if (versesList.length > 0) {

                currentVerseIndex = 0;

                isPlayingFullSurah = true;

                playMode = 'full';

                // ✅ إظهار أزرار السورة الكاملة
                if (repeatSurahBtn) {
                    repeatSurahBtn.style.display = '';
                }

                if (autoNextSurahBtn) {
                    autoNextSurahBtn.style.display = '';
                }

                // ✅ إيقاف تكرار الآية لو كان شغال
                repeatEnabled = false;
                repeatCount = 0;

                // ✅ إطفاء زر تشغيل آية بآية لو كان مفعّل
                const sequenceBtn =
                    document.getElementById('playSequenceBtn');

                if (sequenceBtn) {
                    sequenceBtn.classList.remove('active');
                }

                // ✅ إخفاء زر تكرار الآية أثناء تشغيل السورة كاملة
                const repeatBtn =
                    document.getElementById('repeatVerseBtn');

                if (repeatBtn) {
                    repeatBtn.classList.remove('active');
                    repeatBtn.style.display = 'none';
                }

                // ✅ تشغيل ملف السورة الكاملة فقط
                playAudio(
                    surahNumber,
                    0,
                    window.surahName
                );
            }
        });
    }


   // ✅ تشغيل آية منفردة (Event Delegation)

document.addEventListener('click', (e) => {

    const btn = e.target.closest('.play-verse-btn');

    if (!btn) return;

    const surah =
        parseInt(btn.dataset.surah);

    const verse =
        parseInt(btn.dataset.verse);

    const audio =
        document.getElementById('audioElement');

    // ✅ نفس الآية شغالة → pause
    if (
        currentPlayingVerseBtn === btn &&
        audio &&
        !audio.paused
    ) {

        audio.pause();

        updatePlayIcon(false);

        btn.innerHTML =
            '<i class="fas fa-play"></i>';

        return;
    }

    // ✅ نفس الآية متوقفة → resume
    if (
        currentPlayingVerseBtn === btn &&
        audio &&
        audio.paused
    ) {

        audio.play();

        updatePlayIcon(true);

        btn.innerHTML =
            '<i class="fas fa-pause"></i>';

        return;
    }

    // ✅ آية جديدة
    isPlayingFullSurah = false;

    playMode = 'ayah';

    const sequenceBtn =
        document.getElementById('playSequenceBtn');

    if (sequenceBtn) {
        sequenceBtn.classList.remove('active');
    }

    repeatSurahEnabled = false;
    autoNextSurahEnabled = false;

    if (repeatSurahBtn) {
        repeatSurahBtn.style.display = 'none';
        repeatSurahBtn.classList.remove('active');
    }

    if (autoNextSurahBtn) {
        autoNextSurahBtn.style.display = 'none';
        autoNextSurahBtn.classList.remove('active');
    }

    playAudio(
        surah,
        verse,
        window.surahName
    );
});



    // ✅ أزرار القرّاء
    document
        .querySelectorAll('.reciter-btn')
        .forEach(btn => {

            btn.addEventListener('click', () => {

                document
                    .querySelectorAll('.reciter-btn')
                    .forEach(b => b.classList.remove('active'));

                btn.classList.add('active');

                currentReciterId =
                    btn.dataset.reciterId;

                // ✅ تحديث dropdown
                if (reciterSelect) {

                    const reciterId =
                        btn.dataset.reciterId;

                    reciterSelect.value =
                        reciterId;
                }

                // ✅ تحديث أدوات آية بآية حسب القارئ
                updateTahfeezToolsForReciter(
                    btn.dataset.identifier
                );
            });
        });

    // ✅ السابق
    if (prevBtn) {

        prevBtn.addEventListener('click', () => {

            // ✅ في وضع آية بآية: السابق = الآية السابقة
            if (
                playMode === 'sequence' &&
                currentVerseIndex > 0
            ) {

                currentVerseIndex--;

                const verse =
                    versesList[currentVerseIndex];

                playAudio(
                    window.currentSurah,
                    verse,
                    window.surahName
                );

                return;
            }

            // ✅ في وضع السورة الكاملة: السابق = السورة السابقة
            if (
                playMode === 'full' &&
                isPlayingFullSurah
            ) {

                if (window.prevSurah) {

                    const selectedReciter =
                        getReciterId();

                    navigateToSurah(
                        window.prevSurah,
                        { autoplay: true, autoNext: autoNextSurahEnabled, reciter: selectedReciter }
                    );

                } else {

                    showToast(
                        'هذه أول سورة',
                        'info'
                    );
                }
            }
        });
    }

    // ✅ التالي
    if (nextBtn) {

        nextBtn.addEventListener('click', () => {

            // ✅ في وضع آية بآية: التالي = الآية التالية
            if (
                playMode === 'sequence' &&
                currentVerseIndex < versesList.length - 1
            ) {

                currentVerseIndex++;

                const verse =
                    versesList[currentVerseIndex];

                playAudio(
                    window.currentSurah,
                    verse,
                    window.surahName
                );

                return;
            }

            // ✅ في وضع السورة الكاملة: التالي = السورة التالية
            if (
                playMode === 'full' &&
                isPlayingFullSurah
            ) {

                if (window.nextSurah) {

                    const selectedReciter =
                        getReciterId();

                    navigateToSurah(
                        window.nextSurah,
                        { autoplay: true, autoNext: autoNextSurahEnabled, reciter: selectedReciter }
                    );

                } else {

                    showToast(
                        'هذه آخر سورة',
                        'info'
                    );
                }
            }
        });
    }

    // ✅ تشغيل آية بآية
    const sequenceBtn =
        document.getElementById('playSequenceBtn');

    if (sequenceBtn) {

        sequenceBtn.addEventListener('click', () => {

            sequenceBtn.classList.toggle('active');

            const enabled =
                sequenceBtn.classList.contains('active');

            // ✅ زر تكرار الآية
            const repeatBtn =
                document.getElementById('repeatVerseBtn');

            if (enabled) {

                // ✅ تجهيز قائمة الآيات
               buildVersesList();

                if (versesList.length === 0) {
                    showToast('لا توجد آيات للتشغيل', 'error');
                    sequenceBtn.classList.remove('active');
                    return;
                }

                currentVerseIndex = 0;

                // ✅ وضع تشغيل آية بآية
                playMode = 'sequence';
                isPlayingFullSurah = false;

                // ✅ إطفاء خصائص السورة الكاملة في وضع آية بآية
                repeatSurahEnabled = false;
                autoNextSurahEnabled = false;

                // ✅ إخفاء أزرار السورة الكاملة أثناء وضع آية بآية
                if (repeatSurahBtn) {
                    repeatSurahBtn.style.display = 'none';
                    repeatSurahBtn.classList.remove('active');
                }

                if (autoNextSurahBtn) {
                    autoNextSurahBtn.style.display = 'none';
                    autoNextSurahBtn.classList.remove('active');
                }

                // ✅ إظهار زر تكرار الآية
                if (repeatBtn) {
                    repeatBtn.style.display = '';
                }

                // ✅ تشغيل أول آية
                playAudio(
                    window.currentSurah,
                    versesList[currentVerseIndex],
                    window.surahName
                );

                showToast(
                    '✅ تم تفعيل تشغيل آية بآية',
                    'success'
                );

            } else {

                // ✅ إيقاف وضع آية بآية
                playMode = 'full';
                isPlayingFullSurah = false;

                repeatEnabled = false;
                repeatCount = 0;

                // ✅ إخفاء زر التكرار
                if (repeatBtn) {
                    repeatBtn.style.display = 'none';
                    repeatBtn.classList.remove('active');
                }

                // ✅ إظهار أزرار السورة الكاملة مرة أخرى
                if (repeatSurahBtn) {
                    repeatSurahBtn.style.display = '';
                    repeatSurahBtn.classList.remove('active');
                }

                if (autoNextSurahBtn) {
                    autoNextSurahBtn.style.display = '';
                    autoNextSurahBtn.classList.remove('active');
                }

                // ✅ إيقاف الصوت الحالي
                const audio =
                    document.getElementById('audioElement');

                if (audio) {
                    audio.pause();
                    audio.src = '';
                }

                // ✅ رجوع زر الآية لو كان باين pause
                if (currentPlayingVerseBtn) {
                    currentPlayingVerseBtn.innerHTML =
                        '<i class="fas fa-play"></i>';

                    currentPlayingVerseBtn = null;
                }

                updatePlayIcon(false);
                hideAudioPlayer();

                showToast(
                    '⏹ تم إيقاف تشغيل آية بآية',
                    'info'
                );
            }
        });
    }

    // ✅ قراءة بارامترات الرابط
    const params =
        new URLSearchParams(window.location.search);

    // ✅ استرجاع القارئ المختار من الرابط
    const reciterFromUrl =
        params.get('reciter');

    if (reciterFromUrl) {

        currentReciterId = reciterFromUrl;

        // ✅ تحديث dropdown
        if (reciterSelect) {
            reciterSelect.value = reciterFromUrl;
        }

        // ✅ تحديث أزرار القرّاء حسب القارئ القادم من الرابط
        document
            .querySelectorAll('.reciter-btn')
            .forEach(btn => {

                const isActive =
                    btn.dataset.reciterId === reciterFromUrl;

                btn.classList.toggle('active', isActive);

                if (isActive) {
                    updateTahfeezToolsForReciter(
                        btn.dataset.identifier
                    );
                }
            });
    }

    // ✅ لو جاي من تشغيل تلقائي للسورة التالية
    if (params.get('autoNext') === '1') {

        autoNextSurahEnabled = true;
        repeatSurahEnabled = false;

        if (autoNextSurahBtn) {
            autoNextSurahBtn.classList.add('active');
            autoNextSurahBtn.style.display = '';
        }

        if (repeatSurahBtn) {
            repeatSurahBtn.classList.remove('active');
            repeatSurahBtn.style.display = '';
        }
    }

    // ✅ ضبط أدوات التحفيظ عند فتح الصفحة حسب القارئ الحالي
    const activeReciter =
        document.querySelector('.reciter-btn.active');

    if (activeReciter) {
        updateTahfeezToolsForReciter(
            activeReciter.dataset.identifier
        );
    }

    // ✅ تشغيل السورة كاملة تلقائيًا بعد الانتقال من السابق/التالي أو autoNext
    if (params.get('autoplay') === 'full') {

        const playFullBtn =
            document.getElementById('playFullSurah');

        if (playFullBtn) {
            if (isIOS()) {
                const surahNumber = parseInt(playFullBtn.dataset.surah);
                if (surahNumber) {
                    playAudio(surahNumber, 0, window.surahName);
                }
            } else {
                setTimeout(() => {
                    playFullBtn.click();
                }, 300);
            }
        }
    }
}



// ===== Copy Verse =====
function initCopyButtons() {

    document.addEventListener('click', (e) => {

        const btn = e.target.closest('.copy-btn');

        if (!btn) return;

        const verseText = btn.dataset.verse;

        if (!verseText) return;

        navigator.clipboard.writeText(verseText)
            .then(() => {

                showToast(
                    'تم النسخ بنجاح',
                    'success'
                );

            })
            .catch(() => {

                const textarea =
                    document.createElement('textarea');

                textarea.value = verseText;

                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';

                document.body.appendChild(
                    textarea
                );

                textarea.select();

                document.execCommand('copy');

                document.body.removeChild(
                    textarea
                );

                showToast(
                    'تم النسخ بنجاح',
                    'success'
                );
            });

    });
}

// ===== Favorites Tabs =====
function initFavoritesTabs() {
    const tabs = document.querySelectorAll('.fav-tab');
    const contents = document.querySelectorAll('.fav-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            contents.forEach(c => c.classList.remove('active'));
            document.getElementById(`fav-${target}-tab`)?.classList.add('active');
        });
    });
}

// ===== Save Progress (Tahfeez) =====
function initSaveProgress() {

    document.addEventListener('click', (e) => {

        const btn = e.target.closest('.save-progress-btn');

        if (!btn) return;

        const surah = parseInt(
            btn.dataset.surah
        );

        const verse = parseInt(
            btn.dataset.verse
        );

        if (!isLoggedIn()) {

            showToast(
                'يرجى تسجيل الدخول أولاً',
                'info'
            );

            setTimeout(() => {

                window.location.href =
                    '/login';

            }, 1500);

            return;
        }

        // إلغاء الحفظ
        if (
            btn.classList.contains(
                'active'
            )
        ) {

            apiFetch('/api/progress', {
                method: 'POST',
                body: JSON.stringify({
                    surah_number: null,
                    verse_number: null
                })
            })
            .then(() => {

                btn.classList.remove(
                    'active'
                );

                showToast(
                    'تم إزالة موضع الحفظ ❌',
                    'info'
                );
            })
            .catch(err => {

                console.error(err);

                showToast(
                    'خطأ في الاتصال',
                    'error'
                );
            });

            return;
        }

        // حفظ جديد
        apiFetch('/api/progress', {
            method: 'POST',
            body: JSON.stringify({
                surah_number: surah,
                verse_number: verse
            })
        })
        .then(r => r.json())
        .then(data => {

            if (!data.success) {

                showToast(
                    data.message || 'حدث خطأ',
                    'error'
                );

                return;
            }

            document
                .querySelectorAll(
                    '.save-progress-btn'
                )
                .forEach(b => {

                    b.classList.remove(
                        'active'
                    );
                });

            btn.classList.add(
                'active'
            );

            showToast(
                'تم حفظ موضع الحفظ ✅',
                'success'
            );
        })
        .catch(err => {

            console.error(err);

            showToast(
                'خطأ في الاتصال',
                'error'
            );
        });

    });
}


// ===== Resumeprogress =====

function initResumeProgress() {
    const btn = document.getElementById('resumeProgressBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
if (!isLoggedIn()) {
    showToast('يرجي تسجيل الدخول أولاً', 'info');

    setTimeout(() => {
        window.location.href = '/login';
    }, 1500);

    return;
}
        apiFetch('/api/progress')
            .then(r => r.json())
            .then(data => {

                // ✅ لو مفيش حفظ
               if (data.surah === null || data.verse === null){
                    showToast('لا يوجد موضع حفظ', 'info');
                    return;
                }

                // ✅ يروح لنفس السورة والآية
                window.location.href = `/surah/${data.surah}?goToVerse=${data.verse}`;
            })
            .catch(() => {
                showToast('خطأ في الاتصال', 'error');
            });
    });
}

// ===== Auth Forms =====
function initAuthForms() {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const errorEl = document.getElementById('loginError');

            errorEl.textContent = '';

            if (!email || !password) {
                errorEl.textContent = 'جميع الحقول مطلوبة';
                return;
            }

            apiFetch('/api/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    showToast(data.message, 'success');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 500);
                } else {
                    errorEl.textContent = data.message || 'خطأ في تسجيل الدخول';
                }
            })
            .catch(err => {
                console.error(err);
                errorEl.textContent = 'حدث خطأ في الاتصال';
            });
        });
    }

    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm_password').value;
            const errorEl = document.getElementById('registerError');

            errorEl.textContent = '';

            if (!name || !email || !password || !confirmPassword) {
                errorEl.textContent = 'جميع الحقول مطلوبة';
                return;
            }

            if (password !== confirmPassword) {
                errorEl.textContent = 'كلمات المرور غير متطابقة';
                return;
            }

            if (password.length < 6) {
                errorEl.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
                return;
            }

            apiFetch('/api/register', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    email,
                    password,
                    confirm_password: confirmPassword
                })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    showToast(data.message, 'success');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 500);
                } else {
                    errorEl.textContent = data.message || 'خطأ في إنشاء الحساب';
                }
            })
            .catch(err => {
                console.error(err);
                errorEl.textContent = 'حدث خطأ في الاتصال';
            });
        });
    }
}

// ===== Toggle Password Visibility =====
function initTogglePassword() {
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            const icon = btn.querySelector('i');

            if (input) {
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.className = 'fas fa-eye-slash';
                } else {
                    input.type = 'password';
                    icon.className = 'fas fa-eye';
                }
            }
        });
    });
}

// ===== Logout =====
function logoutUser(event) {
    if (event) event.preventDefault();

    apiFetch('/api/logout', {
        method: 'POST'
    })
    .then(() => {
        showToast('تم تسجيل الخروج بنجاح', 'info');
        setTimeout(() => {
            window.location.href = '/';
        }, 500);
    })
    .catch(() => {
        window.location.href = '/';
    });
}

// =====  Delete Account ======

function deleteAccount() {

    document
        .getElementById("deleteModal")
        .classList.add("show");
}

function closeDeleteModal() {

    document
        .getElementById("deleteModal")
        .classList.remove("show");
}

function confirmDeleteAccount() {

    fetch('/delete-account', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {

        if (data.success) {

            window.location.href = "/";

        } else {

            alert(data.message || "حدث خطأ");

        }

    })
    .catch(error => {

        console.error(error);

        alert("حدث خطأ");

    });

}

// ===== Keyboard Shortcuts =====
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Space to toggle play/pause (only when not in input)
        if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
            e.preventDefault();
            togglePlayPause();
        }
    });
}

// ===== Search Inside Current Surah =====
function initSurahSearch() {

    const openBtn =
        document.getElementById('openSurahSearchBtn');

    const panel =
        document.getElementById('surahSearchPanel');

    const input =
        document.getElementById('surahSearchInput');

    const info =
        document.getElementById('surahSearchInfo');

   
   	   if (!openBtn || !panel || !input) {
        	 return;
          }


    /* ✅ دالة تنظيف النص العربي (مهمة جدًا) */
    function normalizeArabic(text) {

        return (text || '')
            .toString()
            .toLowerCase()

            // توحيد الألف
            .replace(/[أإآٱ]/g, 'ا')

            // توحيد الياء
            .replace(/[ىی]/g, 'ي')

            // توحيد الهمزات
            .replace(/ؤ/g, 'و')
            .replace(/ئ/g, 'ي')

            // التاء المربوطة
            .replace(/ة/g, 'ه')

            // حذف التشكيل + علامات المصحف
            .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')

            // حذف التطويل
            .replace(/ـ/g, '')

            // حذف الرموز الغريبة
            .replace(/[^\u0621-\u064A0-9\s]/g, '')

            // ترتيب المسافات
            .replace(/\s+/g, ' ')
            .trim();
    }


    function saveOriginalTextIfNeeded(textEl) {
        if (textEl && !textEl.dataset.originalText) {
            textEl.dataset.originalText = textEl.innerHTML;
        }
    }


    function removeHighlights() {

             const verseItems = document.querySelectorAll('.verse-item');

        verseItems.forEach(item => {

            const textEl =
                item.querySelector('.verse-text');

            if (textEl && textEl.dataset.originalText) {
                textEl.innerHTML =
                    textEl.dataset.originalText;
            }

            item.classList.remove('surah-search-match');
        });
    }


    function showAllVerses() {

             const verseItems = document.querySelectorAll('.verse-item');

        verseItems.forEach(item => {
            item.classList.remove('surah-search-hidden');
            item.classList.remove('surah-search-match');
        });

        removeHighlights();

        if (info) {
            info.style.display = 'none';
            info.textContent = '';
        }
    }


    function highlightWords(textEl, query) {

        if (!textEl || !query) return;

        saveOriginalTextIfNeeded(textEl);

        const originalText = textEl.textContent;
        const normalizedQuery = normalizeArabic(query);

        const words = originalText.split(/\s+/);

        const highlighted = words.map(word => {

            const normalizedWord = normalizeArabic(word);

            if (normalizedWord.includes(normalizedQuery)) {
                return `<span class="surah-search-highlight">${word}</span>`;
            }

            return word;

        }).join(' ');

        textEl.innerHTML = highlighted;
    }


async function performSearch() {

    // ✅ لا تبحث قبل اكتمال تحميل السورة
    if (!window.allVersesLoaded) {
        return;
    }

    const query =
        input.value.trim();

    const normalizedQuery =
        normalizeArabic(query);

    let visibleCount = 0;

    removeHighlights();

    if (!query) {

        showAllVerses();
        return;
    }

    const verseItems =
        document.querySelectorAll('.verse-item');

    verseItems.forEach(item => {

        const verseNumber =
            item.dataset.verseNumber || '';

        const textEl =
            item.querySelector('.verse-text');

        const verseText =
            textEl
                ? textEl.textContent
                : '';

        let normalizedText =
            normalizeArabic(verseText);

        if (window.currentSurah !== 1) {

            if (
                normalizedText.startsWith(
                    'بسم الله الرحمن الرحيم'
                )
            ) {

                normalizedText =
                    normalizedText
                        .replace(
                            'بسم الله الرحمن الرحيم',
                            ''
                        )
                        .trim();
            }
        }

        let matched = false;

        if (verseNumber === query) {

            matched = true;

        } else if (
            normalizedText.includes(
                normalizedQuery
            )
        ) {

            matched = true;
        }

        if (matched) {

            item.classList.remove(
                'surah-search-hidden'
            );

            item.classList.add(
                'surah-search-match'
            );

            visibleCount++;

            if (verseNumber !== query) {

                highlightWords(
                    textEl,
                    query
                );
            }

        } else {

            item.classList.add(
                'surah-search-hidden'
            );

            item.classList.remove(
                'surah-search-match'
            );
        }
    });

    if (info) {

        info.style.display = '';

        if (visibleCount > 0) {

            info.textContent =
                `تم العثور على ${visibleCount} نتيجة داخل السورة`;

        } else {

            info.textContent =
                'لا توجد نتائج داخل هذه السورة';
        }
    }
}



async function openSearchPanel() {

    panel.style.display = '';
    openBtn.classList.add('active');

    input.disabled = true;

    if (!window.allVersesLoaded) {

        if (info) {

            info.style.display = '';

            info.textContent =
                'جاري تجهيز البحث...';
        }

        await loadUntilVerse(
            window.totalVerses
        );

        window.allVersesLoaded = true;
    }

    input.disabled = false;

    if (info) {

        info.style.display = 'none';
        info.textContent = '';
    }

    setTimeout(() => input.focus(), 100);
}



    function closeSearchPanel() {

        input.value = '';
        showAllVerses();

        panel.style.display = 'none';
        openBtn.classList.remove('active');
    }


    openBtn.addEventListener('click', () => {

        const isOpen =
            panel.style.display !== 'none';

        if (isOpen) closeSearchPanel();
        else openSearchPanel();
    });


let searchTimer;

input.addEventListener('input', () => {

    clearTimeout(searchTimer);

    searchTimer = setTimeout(() => {

        performSearch();

    }, 300);

});


    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSearchPanel();
        }
    });
}


// ===== Azkar Counter Page =====
function initAzkarCounter() {

    const page = document.querySelector('.azk-page');
    if (!page) return;

    const STORAGE_KEY = 'azkar_counter_v2';
    const TARGETS_KEY = 'azkar_targets_v2';
    const DAILY_KEY = 'azkar_daily_v2';

    const defaults = {
        subhanallah: 0,
        alhamdulillah: 0,
        allahuakbar: 0,
        laelahaellallah: 0,
        astaghfirullah: 0,
        salat_ala_nabi: 0
    };

    const defaultTargets = {
        subhanallah: 33,
        alhamdulillah: 33,
        allahuakbar: 34,
        laelahaellallah: 100,
        astaghfirullah: 100,
        salat_ala_nabi: 100
    };

    let counts = {
        ...defaults,
        ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {})
    };

    let targets = {
        ...defaultTargets,
        ...(JSON.parse(localStorage.getItem(TARGETS_KEY)) || {})
    };

    function getLocalDateKey() {
        const now = new Date();

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    const today = getLocalDateKey();

    let daily =
        JSON.parse(localStorage.getItem(DAILY_KEY)) ||
        {
            date: today,
            total: 0
        };

    if (daily.date !== today) {
        daily = {
            date: today,
            total: 0
        };
    }

    const totalEl =
        document.getElementById('azkTotalCount');

    const todayEl =
        document.getElementById('azkTodayCount');

    const resetAllBtn =
        document.getElementById('azkResetAll');

    const changeTargetBtn =
        document.getElementById('azkChangeTarget');

    const targetModal =
        document.getElementById('azkTargetModal');

    const targetSelect =
        document.getElementById('azkTargetZikr');

    const targetInput =
        document.getElementById('azkTargetInput');

    const saveTargetBtn =
        document.getElementById('azkSaveTarget');

    const closeTargetBtn =
        document.getElementById('azkCloseTargetModal');

    const cancelTargetBtn =
        document.getElementById('azkCancelTarget');


    function ensureDailyIsCurrent() {
        const currentDay = getLocalDateKey();

        if (daily.date !== currentDay) {
            daily = {
                date: currentDay,
                total: 0
            };

            localStorage.setItem(
                DAILY_KEY,
                JSON.stringify(daily)
            );
        }
    }


    function save() {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(counts)
        );

        localStorage.setItem(
            TARGETS_KEY,
            JSON.stringify(targets)
        );

        localStorage.setItem(
            DAILY_KEY,
            JSON.stringify(daily)
        );
    }


    function render() {

        ensureDailyIsCurrent();

        let total = 0;

        Object.keys(counts).forEach(key => {

            const countEl =
                page.querySelector(`[data-count="${key}"]`);

            const barEl =
                page.querySelector(`[data-bar="${key}"]`);

            const targetEl =
                page.querySelector(`[data-target="${key}"]`);

            const target =
                targets[key] || 1;

            const value =
                counts[key] || 0;

            if (countEl) {
                countEl.textContent = value;

                countEl.classList.toggle(
                    'done',
                    value >= target && target > 0
                );
            }

            if (targetEl) {
                targetEl.textContent = target;
            }

            if (barEl) {
                barEl.style.width =
                    Math.min(100, (value / target) * 100) + '%';
            }

            total += value;
        });

        if (totalEl) {
            totalEl.textContent = total;
        }

        if (todayEl) {
            todayEl.textContent = daily.total;
        }
    }


    page.addEventListener('click', e => {

        const btn =
            e.target.closest('button[data-action]');

        if (!btn) return;

        const action =
            btn.dataset.action;

        const zikr =
            btn.dataset.zikr;

        if (!zikr) return;

        if (action === 'add') {

            ensureDailyIsCurrent();

            counts[zikr] =
                (counts[zikr] || 0) + 1;

            daily.total += 1;

            const countEl =
                page.querySelector(`[data-count="${zikr}"]`);

            if (countEl) {
                countEl.classList.add('pop');

                setTimeout(() => {
                    countEl.classList.remove('pop');
                }, 180);
            }

            btn.classList.add('clicked');

            setTimeout(() => {
                btn.classList.remove('clicked');
            }, 120);

            if (counts[zikr] === targets[zikr]) {

               if (navigator.vibrate) {
                  navigator.vibrate([100, 50, 100]);
            }

               if (typeof showToast === 'function') {
                 showToast('بارك الله فيك، أكملت هدف الذكر ✨', 'success');
           }
        }

            save();
            render();
        }

        if (action === 'reset') {

            counts[zikr] = 0;

            save();
            render();
        }
    });


    if (resetAllBtn) {

        resetAllBtn.addEventListener('click', () => {

            Object.keys(counts).forEach(key => {
                counts[key] = 0;
            });

            // مهم:
            // لا نصفر daily.total هنا
            // لأن "ذكر اليوم" يمثل نشاط اليوم كله
            // ويتصفر تلقائيًا عند يوم جديد فقط.

            save();
            render();
        });
    }


    function openTargetModal() {

        if (!targetModal || !targetSelect || !targetInput) return;

        const selectedZikr =
            targetSelect.value || 'subhanallah';

        targetInput.value =
            targets[selectedZikr] || 33;

        targetModal.hidden = false;

        setTimeout(() => {
            targetInput.focus();
        }, 100);
    }


    function closeTargetModal() {

        if (targetModal) {
            targetModal.hidden = true;
        }
    }


    if (changeTargetBtn) {
        changeTargetBtn.addEventListener('click', openTargetModal);
    }


    if (targetSelect) {

        targetSelect.addEventListener('change', () => {

            const zikr =
                targetSelect.value;

            targetInput.value =
                targets[zikr] || 33;
        });
    }


    if (saveTargetBtn) {

        saveTargetBtn.addEventListener('click', () => {

            const zikr =
                targetSelect.value;

            const newTarget =
                parseInt(targetInput.value, 10);

            if (!zikr || !newTarget || newTarget < 1) {
                targetInput.focus();
                return;
            }

            targets[zikr] = newTarget;

            save();
            render();
            closeTargetModal();
        });
    }


    if (closeTargetBtn) {
        closeTargetBtn.addEventListener('click', closeTargetModal);
    }

    if (cancelTargetBtn) {
        cancelTargetBtn.addEventListener('click', closeTargetModal);
    }

    if (targetModal) {

        targetModal.addEventListener('click', e => {

            if (e.target === targetModal) {
                closeTargetModal();
            }
        });
    }

    document.addEventListener('keydown', e => {

        if (e.key === 'Escape') {
            closeTargetModal();
        }
    });

    render();
}



function renderVerse(verse) {

    const favoriteClass =
        verse.is_favorite ? 'active' : '';

    const favoriteIcon =
        verse.is_favorite
            ? 'fas fa-star'
            : 'far fa-star';

    const sajdaHtml =
        verse.sajda
            ? `
                <div class="sajda-badge">
                    <i class="fas fa-mosque"></i>
                    سجدة
                </div>
            `
            : '';

    return `
        <div class="verse-item"
             id="verse-${verse.verse_number}"
             data-verse-id="${verse.id}"
             data-verse-number="${verse.verse_number}">

            <div class="verse-header">

                <div class="verse-actions">

                    <button class="verse-btn copy-btn"
                            data-verse="${verse.text}"
                            title="نسخ">
                        <i class="fas fa-copy"></i>
                    </button>

                    <button
                        class="verse-btn fav-btn-verse ${favoriteClass}"
                        data-surah-id="${window.currentSurah}"
                        data-verse-id="${verse.id}"
                        title="مفضلة">

                        <i class="${favoriteIcon}"></i>
                    </button>

                    <button
                        class="verse-btn save-progress-btn"
                        data-surah="${window.currentSurah}"
                        data-verse="${verse.verse_number}"
                        title="حفظ موضع الحفظ">

                        <i class="fas fa-bookmark"></i>
                    </button>

                    <button
                        class="verse-btn eye-btn"
                        onclick="toggleVerse(${verse.id}, this)">

                        <span class="eye open"></span>

                    </button>

                    <button
                        class="verse-btn play-verse-btn"
                        data-surah="${window.currentSurah}"
                        data-verse="${verse.verse_number}"
                        title="استماع">

                        <i class="fas fa-play"></i>
                    </button>

                </div>

                <div class="verse-number-badge">
                    ${verse.verse_number}
                </div>

            </div>

            <div class="verse-text"
                 id="verse-text-${verse.id}">
                ${verse.text}
            </div>

            <button class="show-tafsir-btn"
                    onclick="toggleTafsir(this)">
                عرض التفسير
            </button>

            <div class="tafsir-box">
                هذا مكان التفسير
            </div>

            ${sajdaHtml}

        </div>
    `;
}


let loadedVersesCount = 50;
let isLoadingMoreVerses = false;


async function loadUntilVerse(targetVerse) {

    targetVerse = parseInt(targetVerse);

    while (
        loadedVersesCount < targetVerse &&
        loadedVersesCount < window.totalVerses
    ) {

        await loadMoreVerses();
    }

    return true;
}


async function loadMoreVerses() {

    if (isLoadingMoreVerses) return;

    if (
        loadedVersesCount >=
        window.totalVerses
    ) {
        return;
    }

    isLoadingMoreVerses = true;

    try {

        const response = await fetch(
            `/api/surah/${window.currentSurah}/verses?offset=${loadedVersesCount}&limit=50`
        );

        const data = await response.json();

        if (!data.success) {
            return;
        }

        const container =
            document.getElementById(
                'versesContainer'
            );

        if (!container) {
            return;
        }

        data.verses.forEach(verse => {

            container.insertAdjacentHTML(
                'beforeend',
                renderVerse(verse)
            );

        });

        loadedVersesCount +=
            data.verses.length;

        console.log(
            'Loaded:',
            loadedVersesCount
        );

    } catch (err) {

        console.error(err);

    } finally {

        isLoadingMoreVerses = false;
    }
}


function toggleQuizHistory() {
    const list = document.getElementById('quizHistoryList');
    const icon = document.getElementById('quizToggleIcon');
    const text = document.getElementById('quizToggleText');

    if (list.style.display === 'none') {
        list.style.display = '';
        icon.className = 'fas fa-chevron-up';
        text.textContent = 'إخفاء النتائج';
    } else {
        list.style.display = 'none';
        icon.className = 'fas fa-chevron-down';
        text.textContent = 'عرض النتائج';
    }
}

// ===== Initialize Everything =====
document.addEventListener('DOMContentLoaded', () => {

    console.time("PAGE_INIT");

    initDarkMode();
    initMobileMenu();
    initSearch();
    initSurahSearch();
    initFavorites();
    initAudioPlayer();
    initCopyButtons();
    initFavoritesTabs();
    initAuthForms();
    initTogglePassword();
    initKeyboardShortcuts();    
    initSaveProgress();
    initResumeProgress();
    initAzkarCounter();  
      
 
  // ✅ النزول لموضع الحفظ
const params =
    new URLSearchParams(
        window.location.search
    );

const targetVerse =
    params.get("goToVerse");

if (targetVerse) {

    setTimeout(async () => {

        await loadUntilVerse(
            targetVerse
        );

        const el =
            document.querySelector(
                `.verse-item[data-verse-number="${targetVerse}"]`
            );

        if (el) {

            el.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });

            el.style.border =
                "2px solid #2d6a4f";

            setTimeout(() => {

                el.style.border = "";

            }, 2000);
        }

    }, 300);
}


// ✅ الانتقال إلى الآية المطلوبة من المفضلة

if (window.targetVerse > 0) {

    const timer = setInterval(() => {

        const el = document.getElementById(
            `verse-${window.targetVerse}`
        );

        if (el) {

            clearInterval(timer);

            setTimeout(() => {

                el.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });

                el.style.boxShadow =
                    '0 0 0 3px rgba(45,106,79,0.25)';

                setTimeout(() => {

                    el.style.boxShadow = '';

                }, 2000);

            }, 800);

            return;
        }

        if (
            loadedVersesCount <
            window.targetVerse
        ) {

            loadMoreVerses();
        }

    }, 300);
}



const trigger =
    document.getElementById(
        'loadMoreTrigger'
    );

if (trigger) {

    const observer =
        new IntersectionObserver(
            (entries) => {

                if (
                    entries[0].isIntersecting
                ) {

                    loadMoreVerses();
                }

            },
            {
                rootMargin: '500px'
            }
        );

    window.lazyLoadObserver = observer;
    observer.observe(trigger);
}

    // ✅ Handle back button on iOS SPA navigation
    window.addEventListener('popstate', (e) => {
        if (isIOS() && window.location.pathname.startsWith('/surah/')) {
            location.reload();
        }
    });

    console.timeEnd("PAGE_INIT");

});


// =====================================================
// Download Mushaf Offline
// =====================================================

const MUSHAF_OFFLINE_CACHE = 'quran-mushaf-offline-v1';

let isMushafDownloading = false;

const MUSHAF_OFFLINE_ASSETS = [
    '/mushaf',
    '/manifest.json',

    '/static/css/style.css',
    '/static/js/main.js',

    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png',

    // ملفات الروايات
    '/static/data/riwayat/hafsData_v18.json',
    '/static/data/riwayat/warshData_v10.json',
    '/static/data/riwayat/QaloonData_v10.json',
    '/static/data/riwayat/ShoubaData08.json',
    '/static/data/riwayat/DooriData_v09.json',
    '/static/data/riwayat/SoosiData09.json',
    '/static/data/riwayat/BazziData_v07.json',
    '/static/data/riwayat/QumbulData_v07.json',

    // خطوط الروايات
    '/static/fonts/riwayat/hafs.18.woff2',
    '/static/fonts/riwayat/warsh.10.woff2',
    '/static/fonts/riwayat/qaloon.10.woff2',
    '/static/fonts/riwayat/shouba.8.woff2',
    '/static/fonts/riwayat/doori.9.woff2',
    '/static/fonts/riwayat/soosi.9.woff2',
    '/static/fonts/riwayat/bazzi.7.woff2',
    '/static/fonts/riwayat/qumbul.7.woff2'
];

function getMushafOfflineElements() {
    return {
        downloadButton: document.getElementById('mushafDownloadBtn'),
        removeButton: document.getElementById('mushafRemoveDownloadBtn'),
        statusBox: document.getElementById('mushafOfflineStatus'),
        statusText: document.getElementById('mushafOfflineStatusText'),
        progressBar: document.getElementById('mushafOfflineProgressBar')
    };
}

function setMushafOfflineProgress(loaded, total, message = null) {
    const {
        statusBox,
        statusText,
        progressBar
    } = getMushafOfflineElements();

    if (!statusBox || !statusText || !progressBar) {
        return;
    }

    const percent =
        total > 0
            ? Math.round((loaded / total) * 100)
            : 0;

    statusBox.classList.add('show');
    statusBox.classList.remove('complete');

    statusText.innerHTML =
        message || `جاري التحميل... ${percent}% — تم تحميل ${loaded} من ${total} ملف`;

    progressBar.style.width =
        `${percent}%`;
}

function setMushafOfflineReady() {
    const {
        downloadButton,
        removeButton,
        statusBox,
        statusText,
        progressBar
    } = getMushafOfflineElements();

    // بعد اكتمال التحميل نخفي زر التحميل
    if (downloadButton) {
        downloadButton.style.display = 'none';
        downloadButton.disabled = false;
        downloadButton.classList.remove('downloaded');
    }

    // ونظهر زر إزالة التحميل فقط
    if (removeButton) {
        removeButton.style.display = 'inline-flex';
    }

    // رسالة بسيطة بدون شريط تقدم
    if (statusBox && statusText && progressBar) {
        statusBox.classList.add('show');
        statusBox.classList.add('complete');

        statusText.innerHTML =
            'المصحف متاح للقراءة بدون نت ✅';

        progressBar.style.width =
            '100%';
    }
}

function setMushafOfflineNotReady() {
    const {
        downloadButton,
        removeButton,
        statusBox,
        statusText,
        progressBar
    } = getMushafOfflineElements();

    // لو مش متحمل، نظهر زر التحميل
    if (downloadButton) {
        downloadButton.style.display = 'inline-flex';
        downloadButton.disabled = false;
        downloadButton.classList.remove('downloaded');

        downloadButton.innerHTML = `
            <i class="fas fa-download"></i>
            تحميل المصحف بدون نت
        `;
    }

    // ونخفي زر الإزالة
    if (removeButton) {
        removeButton.style.display = 'none';
    }

    if (statusBox && statusText && progressBar) {
        statusBox.classList.remove('show');
        statusBox.classList.remove('complete');

        statusText.innerHTML =
            'لم يتم تحميل ملفات المصحف بعد';

        progressBar.style.width =
            '0%';
    }
}

async function countCachedMushafAssets() {
    if (!('caches' in window)) {
        return 0;
    }

    const cache =
        await caches.open(MUSHAF_OFFLINE_CACHE);

    let cachedCount = 0;

    for (const asset of MUSHAF_OFFLINE_ASSETS) {
        const match =
            await cache.match(asset);

        if (match) {
            cachedCount++;
        }
    }

    return cachedCount;
}

async function refreshMushafOfflineState() {

    const isReady =
        localStorage.getItem('mushaf_offline_ready') === 'true';

    // ✅ لو التحميل اكتمل قبل كده، اعرض الحالة كجاهزة فورًا
    if (isReady) {
        setMushafOfflineReady();
        return;
    }

    // ✅ لو مش جاهز، نعمل فحص خفيف للكاش عشان نعرف هل فيه تحميل جزئي
    if (!('caches' in window)) {
        setMushafOfflineNotReady();
        return;
    }

    const total =
        MUSHAF_OFFLINE_ASSETS.length;

    const cachedCount =
        await countCachedMushafAssets();

    if (cachedCount > 0) {

        setMushafOfflineProgress(
            cachedCount,
            total,
            `تم تحميل ${cachedCount} من ${total} ملف — يمكنك استكمال التحميل`
        );

        const {
            downloadButton,
            removeButton
        } = getMushafOfflineElements();

        if (downloadButton) {
            downloadButton.style.display = 'inline-flex';
            downloadButton.disabled = false;
            downloadButton.classList.remove('downloaded');

            downloadButton.innerHTML = `
                <i class="fas fa-redo"></i>
                استكمال التحميل
            `;
        }

        if (removeButton) {
            removeButton.style.display = 'inline-flex';
        }

        return;
    }

    setMushafOfflineNotReady();
}


async function downloadMushafOffline(button) {
    if (!('caches' in window)) {
        const {
            statusBox,
            statusText
        } = getMushafOfflineElements();

        if (statusBox && statusText) {
            statusBox.classList.add('show');
            statusBox.classList.remove('complete');

            statusText.innerHTML =
                'المتصفح لا يدعم التخزين بدون نت';
        }

        return;
    }

    const total =
        MUSHAF_OFFLINE_ASSETS.length;

    const cache =
        await caches.open(MUSHAF_OFFLINE_CACHE);

    let loaded = 0;
    let failed = 0;

    isMushafDownloading = true;

    button.style.display = 'inline-flex';
    button.disabled = true;
    button.classList.remove('downloaded');

    button.innerHTML = `
        <i class="fas fa-spinner fa-spin"></i>
        جاري التحميل...
    `;

    setMushafOfflineProgress(0, total);

    for (const asset of MUSHAF_OFFLINE_ASSETS) {
        try {
            const cached =
                await cache.match(asset);

            if (!cached) {
                const response =
                    await fetch(asset, {
                        cache: 'no-store'
                    });

                if (!response.ok) {
                    throw new Error(`Failed: ${asset}`);
                }

                await cache.put(
                    asset,
                    response.clone()
                );
            }

            loaded++;

            setMushafOfflineProgress(
                loaded,
                total
            );

        } catch (error) {
            console.warn(
                'تعذر تحميل الملف:',
                asset,
                error
            );

            failed++;
            loaded++;

            setMushafOfflineProgress(
                loaded,
                total,
                `جاري التحميل... ${Math.round((loaded / total) * 100)}% — فشل ${failed} ملف`
            );
        }
    }

    isMushafDownloading = false;

    if (failed === 0) {
        localStorage.setItem(
            'mushaf_offline_ready',
            'true'
        );

        setMushafOfflineReady();

        return;
    }

    localStorage.removeItem(
        'mushaf_offline_ready'
    );

    button.disabled = false;

    button.innerHTML = `
        <i class="fas fa-redo"></i>
        استكمال التحميل
    `;

    setMushafOfflineProgress(
        total - failed,
        total,
        `اكتمل التحميل جزئيًا — فشل ${failed} ملف، اضغط استكمال التحميل`
    );
}

async function removeMushafOffline() {
    if (!('caches' in window)) {
        return;
    }

    await caches.delete(MUSHAF_OFFLINE_CACHE);

    localStorage.removeItem(
        'mushaf_offline_ready'
    );

    setMushafOfflineNotReady();
}

window.addEventListener('beforeunload', function (event) {
    if (isMushafDownloading) {
        event.preventDefault();
        event.returnValue = '';
    }
});

document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('mushafDownloadBtn')) {
        refreshMushafOfflineState();
    }
});


// =====================================================
// Mushaf Local Renderer
// =====================================================

const MUSHAF_RIWAYAT_FILES = {
    hafs: {
        name: 'حفص عن عاصم',
        file: '/static/data/riwayat/hafsData_v18.json',
        fontClass: 'font-hafs'
    },

    warsh: {
        name: 'ورش عن نافع',
        file: '/static/data/riwayat/warshData_v10.json',
        fontClass: 'font-warsh'
    },

    qaloon: {
        name: 'قالون عن نافع',
        file: '/static/data/riwayat/QaloonData_v10.json',
        fontClass: 'font-qaloon'
    },

    shouba: {
        name: 'شعبة عن عاصم',
        file: '/static/data/riwayat/ShoubaData08.json',
        fontClass: 'font-shouba'
    },

    doori: {
        name: 'الدوري عن أبي عمرو',
        file: '/static/data/riwayat/DooriData_v09.json',
        fontClass: 'font-doori'
    },

    soosi: {
        name: 'السوسي عن أبي عمرو',
        file: '/static/data/riwayat/SoosiData09.json',
        fontClass: 'font-soosi'
    },

    bazzi: {
        name: 'البزي عن ابن كثير',
        file: '/static/data/riwayat/BazziData_v07.json',
        fontClass: 'font-bazzi'
    },

    qumbul: {
        name: 'قنبل عن ابن كثير',
        file: '/static/data/riwayat/QumbulData_v07.json',
        fontClass: 'font-qumbul'
    }
};

function getFirstExistingValue(data, keys, defaultValue = null) {
    for (const key of keys) {
        if (
            Object.prototype.hasOwnProperty.call(data, key) &&
            data[key] !== null &&
            data[key] !== undefined
        ) {
            return data[key];
        }
    }

    return defaultValue;
}

function cleanKfgqpcAyahText(text) {
    if (!text) return '';

    // حذف أرقام الآيات فقط مع الحفاظ على علامات الوقف والسجدة
    return String(text)
        .replace(/[0-9٠-٩۰-۹]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeRiwayahData(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (data && Array.isArray(data.data)) {
        return data.data;
    }

    if (data && Array.isArray(data.ayahs)) {
        return data.ayahs;
    }

    if (data && Array.isArray(data.verses)) {
        return data.verses;
    }

    return [];
}

function extractSurahVersesFromRiwayah(data, surahNumber) {
    const list =
        normalizeRiwayahData(data);

    const verses = [];

    for (const ayah of list) {
        if (!ayah || typeof ayah !== 'object') {
            continue;
        }

        const currentSurahRaw =
            getFirstExistingValue(
                ayah,
                [
                    'sura_no',
                    'sora_no',
                    'surah_no',
                    'surah_number',
                    'sura_number',
                    'sora_number',
                    'surah_id',
                    'sura_id',
                    'sora_id',
                    'sura',
                    'sora',
                    'surah'
                ]
            );

        const currentAyahRaw =
            getFirstExistingValue(
                ayah,
                [
                    'aya_no',
                    'ayah_no',
                    'ayah_number',
                    'aya_number',
                    'verse_number',
                    'aya',
                    'ayah'
                ]
            );

        const rawText =
            getFirstExistingValue(
                ayah,
                [
                    'aya_text',
                    'ayah_text',
                    'text',
                    'text_uthmani',
                    'uthmani',
                    'ayaText'
                ],
                ''
            );

        if (
            Number(currentSurahRaw) === Number(surahNumber)
        ) {
            verses.push({
                verseNumber: Number(currentAyahRaw),
                text: cleanKfgqpcAyahText(rawText)
            });
        }
    }

    verses.sort((a, b) => {
        return a.verseNumber - b.verseNumber;
    });

    return verses;
}

function renderMushafSurah({
    surahNumber,
    riwayahKey,
    verses
}) {
    const surahData =
        window.MUSHAF_SURAHS &&
        window.MUSHAF_SURAHS[String(surahNumber)];

    const riwayahData =
        MUSHAF_RIWAYAT_FILES[riwayahKey];

    const surahNameEl =
        document.getElementById('mushafSurahName');

    const surahEnglishEl =
        document.getElementById('mushafSurahEnglish');

    const ayahCountEl =
        document.getElementById('mushafAyahCount');

    const riwayahNameEl =
        document.getElementById('mushafRiwayahName');

    const mushafTextEl =
        document.getElementById('mushafText');

    if (
        !surahData ||
        !riwayahData ||
        !mushafTextEl
    ) {
        return;
    }

    if (surahNameEl) {
        surahNameEl.textContent =
            surahData.name;
    }

    if (surahEnglishEl) {
        surahEnglishEl.textContent =
            surahData.name_en || '';
    }

    if (ayahCountEl) {
        ayahCountEl.textContent =
            surahData.verses_count;
    }

    if (riwayahNameEl) {
        riwayahNameEl.textContent =
            riwayahData.name;
    }

    mushafTextEl.className =
        `mushaf-text ${riwayahData.fontClass || ''}`;

    const html =
        verses.map(verse => {
            return `
                <span class="mushaf-ayah-text">
                    ${verse.text}
                </span>
                <span class="mushaf-ayah-number">
                    ${verse.verseNumber}
                </span>
            `;
        }).join('');

    mushafTextEl.innerHTML =
        html;

    document.title =
        `${surahData.name} — ${riwayahData.name} — المصحف`;

    const newUrl =
        `/mushaf?surah=${surahNumber}&riwayah=${riwayahKey}`;

    window.history.pushState(
        {},
        '',
        newUrl
    );
}

async function loadAndRenderMushafLocally(surahNumber, riwayahKey) {
    const riwayahData =
        MUSHAF_RIWAYAT_FILES[riwayahKey];

    if (!riwayahData) {
        throw new Error('الرواية غير موجودة');
    }

    const response =
        await fetch(riwayahData.file);

    if (!response.ok) {
        throw new Error('تعذر تحميل ملف الرواية');
    }

    const data =
        await response.json();

    const verses =
        extractSurahVersesFromRiwayah(
            data,
            surahNumber
        );

    if (!verses.length) {
        throw new Error('لم يتم العثور على آيات هذه السورة');
    }

    renderMushafSurah({
        surahNumber,
        riwayahKey,
        verses
    });
}

function showMushafLocalError(message) {
    const statusBox =
        document.getElementById('mushafOfflineStatus');

    const statusText =
        document.getElementById('mushafOfflineStatusText');

    if (statusBox && statusText) {
        statusBox.classList.add('show');
        statusBox.classList.remove('complete');

        statusText.innerHTML =
            message;
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const mushafForm =
        document.getElementById('mushafForm');

    if (!mushafForm) {
        return;
    }

    mushafForm.addEventListener('submit', async function (event) {
        event.preventDefault();

        const surahSelect =
            document.getElementById('surahSelect');

        const riwayahSelect =
            document.getElementById('riwayahSelect');

        if (!surahSelect || !riwayahSelect) {
            return;
        }

        const surahNumber =
            Number(surahSelect.value);

        const riwayahKey =
            riwayahSelect.value;

        const submitButton =
            mushafForm.querySelector('.mushaf-show-btn');

        const originalHtml =
            submitButton ? submitButton.innerHTML : '';

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.innerHTML = `
                <i class="fas fa-spinner fa-spin"></i>
                جاري العرض...
            `;
        }

        try {
            await loadAndRenderMushafLocally(
                surahNumber,
                riwayahKey
            );
        } catch (error) {
            console.error(error);

            if (navigator.onLine) {
                // fallback للسيرفر لو المستخدم Online
                mushafForm.submit();
                return;
            }

            showMushafLocalError(
                'تعذر عرض السورة بدون نت، تأكد من تحميل المصحف أولًا'
            );
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.innerHTML =
                    originalHtml;
            }
        }
    });
});