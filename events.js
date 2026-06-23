// App State
const state = {
  events: [],
  completedList: [],
  currentCategory: "all",
  searchQuery: "",
  hideCompleted: false,
  activeTab: "home" // home, analytics, settings
};

// DOM Elements
const eventsList = document.getElementById('events-list');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');
const rewardEstimate = document.getElementById('reward-estimate');
const remainingCount = document.getElementById('remaining-count');
const listTitle = document.getElementById('list-title');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const categoryTabs = document.getElementById('categories-tabs');
const btnToggleCompleted = document.getElementById('btn-toggle-completed');
const btnSync = document.getElementById('btn-sync');
const appNav = document.querySelector('.app-nav');

// Analytics elements
const analyticsRate = document.getElementById('analytics-rate');
const analyticsCompleted = document.getElementById('analytics-completed');
const analyticsRemaining = document.getElementById('analytics-remaining');

// Logo Theme Map
const logoClassMap = {
  portal: "logo-portal",
  shopping: "logo-shopping",
  finance: "logo-finance",
  lifestyle: "logo-lifestyle",
  general: "logo-general"
};

// Load events data asynchronously from data.json
async function loadEventsData() {
  try {
    const res = await fetch('data.json');
    state.events = await res.json();
  } catch (err) {
    console.error("Failed to load events from data.json", err);
    state.events = [];
  }
  
  loadProgress();
  checkMidnightReset();
  renderEvents();
  updateStats();
  setupEventListeners();
}

// Initialise App
function init() {
  loadEventsData();
}

// Load Progress from localStorage
function loadProgress() {
  const saved = localStorage.getItem('checkglow_progress');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      state.completedList = data.completedList || [];
    } catch (e) {
      state.completedList = [];
    }
  }
}

// Save Progress to localStorage
function saveProgress() {
  const data = {
    lastCheckedDate: getTodayString(),
    completedList: state.completedList
  };
  localStorage.setItem('checkglow_progress', JSON.stringify(data));
}

// Midnight Reset Engine
function checkMidnightReset() {
  const saved = localStorage.getItem('checkglow_progress');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      const today = getTodayString();
      if (data.lastCheckedDate !== today) {
        // Day changed, reset progress
        state.completedList = [];
        saveProgress();
      }
    } catch (e) {
      // JSON error, ignore
    }
  }
}

// Helper to get local date string YYYY-MM-DD
function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Stats & Progress Calculation
function updateStats() {
  const total = state.events.length;
  const completed = state.completedList.filter(id => 
    state.events.some(e => e.id === id)
  ).length;
  
  const percentage = total > 0 ? (completed / total) * 100 : 0;

  // Update Home Stats
  if (progressText) progressText.textContent = `${completed} / ${total}`;
  if (progressFill) progressFill.style.width = `${percentage}%`;
  if (rewardEstimate) rewardEstimate.textContent = `${completed}개 완료`;
  if (remainingCount) remainingCount.textContent = `${total - completed}개`;

  // Update Analytics View Stats
  if (analyticsRate) analyticsRate.textContent = `${Math.round(percentage)}%`;
  if (analyticsCompleted) analyticsCompleted.textContent = `${completed}개`;
  if (analyticsRemaining) analyticsRemaining.textContent = `${total - completed}개`;
}

// Render Event Cards List
function renderEvents() {
  if (!eventsList) return;

  // Filter events based on active category & search query
  let filtered = state.events.filter(event => {
    // Category check
    const matchesCategory = state.currentCategory === 'all' || event.category === state.currentCategory;
    
    // Search check
    const cleanQuery = state.searchQuery.trim().toLowerCase();
    const matchesSearch = !cleanQuery || 
                          event.title.toLowerCase().includes(cleanQuery) || 
                          event.company.toLowerCase().includes(cleanQuery);
    
    // Completed check
    const isCompleted = state.completedList.includes(event.id);
    const matchesHidden = !state.hideCompleted || !isCompleted;

    return matchesCategory && matchesSearch && matchesHidden;
  });

  // Empty state rendering
  if (filtered.length === 0) {
    eventsList.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
        <p>조건에 맞는 출석체크가 없습니다.</p>
      </div>
    `;
    return;
  }

  eventsList.innerHTML = filtered.map(event => {
    const isCompleted = state.completedList.includes(event.id);
    const logoClass = logoClassMap[event.category] || "logo-general";

    return `
      <div class="event-card ${isCompleted ? 'completed' : ''}" data-id="${event.id}">
        <div class="event-logo ${logoClass}">${event.logo}</div>
        
        <div class="event-info">
          <span class="event-company">${event.company}</span>
          <span class="event-title">${event.title}</span>
          <span class="event-reward-tag">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            ${event.reward}
          </span>
        </div>

        <div class="check-action" aria-label="출석 완료 체크">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners to newly rendered items
  eventsList.querySelectorAll('.event-card').forEach(card => {
    const id = card.getAttribute('data-id');
    if (!id) return;
    
    // Toggle completion on check button click only
    const checkBtn = card.querySelector('.check-action');
    if (checkBtn) {
      checkBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid triggering card body click
        toggleEventCompletion(id);
      });
    }

    // Open link AND mark complete on card body click
    card.addEventListener('click', () => {
      const eventObj = state.events.find(e => e.id === id);
      if (eventObj) {
        window.open(eventObj.url, '_blank');
        
        // Auto complete since user visited the link
        if (!state.completedList.includes(id)) {
          toggleEventCompletion(id, true);
        }
      }
    });
  });
}

// Toggle completion status helper
function toggleEventCompletion(id, forceValue) {
  const index = state.completedList.indexOf(id);
  const shouldComplete = forceValue !== undefined ? forceValue : (index === -1);

  if (shouldComplete) {
    if (index === -1) {
      state.completedList.push(id);
    }
  } else {
    if (index > -1) {
      state.completedList.splice(index, 1);
    }
  }

  saveProgress();
  updateStats();
  renderEvents();
}

// Event Listeners Setup
function setupEventListeners() {
  
  // Category tabs click
  if (categoryTabs) {
    categoryTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;

      // Toggle active classes
      document.querySelectorAll('#categories-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      state.currentCategory = tab.getAttribute('data-category');
      
      // Update List header text
      const labels = {
        all: "전체 이벤트 목록",
        shopping: "쇼핑몰 출석체크 목록",
        portal: "포털 출석체크 목록",
        finance: "금융 앱 출석체크 목록",
        lifestyle: "라이프/일상 출석체크 목록"
      };
      if (listTitle) listTitle.textContent = labels[state.currentCategory] || "이벤트 목록";

      renderEvents();
    });
  }

  // Search input typing
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      
      // Toggle clear button display
      if (searchClear) {
        if (state.searchQuery.length > 0) {
          searchClear.style.display = 'block';
        } else {
          searchClear.style.display = 'none';
        }
      }

      renderEvents();
    });
  }

  // Clear search query
  if (searchClear) {
    searchClear.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        state.searchQuery = '';
        searchClear.style.display = 'none';
        renderEvents();
        searchInput.focus();
      }
    });
  }

  // Toggle hiding completed events
  if (btnToggleCompleted) {
    btnToggleCompleted.addEventListener('click', () => {
      state.hideCompleted = !state.hideCompleted;
      if (state.hideCompleted) {
        btnToggleCompleted.textContent = "완료 보이기";
        btnToggleCompleted.style.color = "#94a3b8";
      } else {
        btnToggleCompleted.textContent = "완료 숨기기";
        btnToggleCompleted.style.color = "var(--color-primary)";
      }
      renderEvents();
    });
  }

  // Refresh and Sync
  if (btnSync) {
    btnSync.addEventListener('click', () => {
      btnSync.style.transform = 'rotate(360deg)';
      btnSync.style.transition = 'transform 0.6s ease';
      
      setTimeout(() => {
        btnSync.style.transform = 'none';
        btnSync.style.transition = 'none';
        
        checkMidnightReset();
        loadProgress();
        updateStats();
        renderEvents();
        alert('출석 데이터가 최신 상태로 동기화되었습니다.');
      }, 600);
    });
  }

  // Bottom Navigation handler
  if (appNav) {
    appNav.addEventListener('click', (e) => {
      const item = e.target.closest('.nav-item');
      if (!item) return;

      // Toggle active state
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      state.activeTab = item.getAttribute('data-tab');

      // Toggle visible sections
      document.querySelectorAll('.view-section').forEach(section => {
        section.classList.add('hidden');
      });
      
      const activeSection = document.getElementById(`view-${state.activeTab}`);
      if (activeSection) {
        activeSection.classList.remove('hidden');
      }

      // Refresh data on home & analytics view
      if (state.activeTab === 'home') {
        renderEvents();
        updateStats();
      } else {
        updateStats(); // Updates analytics counters dynamically
      }
    });
  }

  // Settings reset button listener
  const btnResetData = document.getElementById('btn-reset-data');
  if (btnResetData) {
    btnResetData.addEventListener('click', () => {
      if (confirm('오늘의 출석 체크 기록을 전부 초기화할까요?')) {
        state.completedList = [];
        saveProgress();
        updateStats();
        renderEvents();
        alert('초기화 완료되었습니다.');
        
        // Redirect back to home tab
        const homeNavBtn = document.querySelector('.nav-item[data-tab="home"]');
        if (homeNavBtn) homeNavBtn.click();
      }
    });
  }
}

// Run Initialisation
init();
