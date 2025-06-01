const GEMINI_FAVORITES_STORAGE_KEY = 'geminiChatFavorites';
const STAR_OUTLINE_URL = chrome.runtime.getURL('icons/star-outline.svg');
const STAR_FILLED_URL = chrome.runtime.getURL('icons/star-filled.svg');

let favoriteConversationIds = new Set();

// --- 存储操作 (与之前版本相同) ---
async function loadFavorites() {
  try {
    const data = await chrome.storage.local.get([GEMINI_FAVORITES_STORAGE_KEY]);
    if (data[GEMINI_FAVORITES_STORAGE_KEY]) {
      favoriteConversationIds = new Set(data[GEMINI_FAVORITES_STORAGE_KEY]);
      // console.log('Gemini Favorites: Loaded favorites:', Array.from(favoriteConversationIds));
    }
  } catch (error) {
    console.error("Gemini Favorites: Error loading favorites:", error);
  }
}

async function saveFavorites() {
  try {
    await chrome.storage.local.set({ [GEMINI_FAVORITES_STORAGE_KEY]: Array.from(favoriteConversationIds) });
    // console.log('Gemini Favorites: Saved favorites:', Array.from(favoriteConversationIds));
  } catch (error) {
    console.error("Gemini Favorites: Error saving favorites:", error);
  }
}

// --- DOM 操作 ---
function extractConversationId(element) {
  const jslog = element.getAttribute('jslog');
  if (jslog) {
    const match = jslog.match(/c_([a-f0-9]{16})/);
    if (match && match[1]) {
      return `c_${match[1]}`;
    }
    const genericMatch = jslog.match(/c_([a-zA-Z0-9_]+)/);
     if (genericMatch && genericMatch[1]) {
        console.warn(`Gemini Favorites: Used fallback ID match for jslog: ${jslog}`);
        return `c_${genericMatch[1]}`;
    }
  }
  return null;
}

function addFavoriteButtonToConversation(conversationElement) {
  if (!conversationElement || conversationElement.querySelector('.gemini-fav-star-button')) {
    return;
  }
  const conversationId = extractConversationId(conversationElement);
  if (!conversationId) {
    return;
  }

  const starButton = document.createElement('div');
  starButton.className = 'gemini-fav-star-button';
  starButton.setAttribute('role', 'button');
  starButton.setAttribute('tabindex', '0');
  
  const starIcon = document.createElement('img');
  const isFavorited = favoriteConversationIds.has(conversationId);

  starIcon.src = isFavorited ? STAR_FILLED_URL : STAR_OUTLINE_URL;
  starButton.title = isFavorited ? 'Unfavorite this chat' : 'Favorite this chat';
  if (isFavorited) {
    starButton.classList.add('is-favorited');
  }
  starButton.setAttribute('aria-pressed', isFavorited.toString());
  
  starButton.appendChild(starIcon);

  starButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const currentlyFavorited = starButton.classList.toggle('is-favorited');
    if (currentlyFavorited) {
      favoriteConversationIds.add(conversationId);
      starIcon.src = STAR_FILLED_URL;
      starButton.title = 'Unfavorite this chat';
      starButton.setAttribute('aria-pressed', 'true');
    } else {
      favoriteConversationIds.delete(conversationId);
      starIcon.src = STAR_OUTLINE_URL;
      starButton.title = 'Favorite this chat';
      starButton.setAttribute('aria-pressed', 'false');
    }
    await saveFavorites();
  });

  // 找到“三个点”菜单图标元素
  const optionsIconElement = conversationElement.querySelector('.options-icon');
  if (optionsIconElement) {
    // 将星号按钮插入到“三个点”菜单之前
    conversationElement.insertBefore(starButton, optionsIconElement);
  } else {
    // 如果找不到“三个点”菜单，作为备选方案，附加到末尾（可能需要调整CSS）
    console.warn("Gemini Favorites: Options icon not found, appending star to end for conversation:", conversationId);
    conversationElement.appendChild(starButton);
  }
}

function processNewNodesInContainer(nodes) {
  nodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches && node.matches('div.conversation[data-test-id="conversation"]')) {
        addFavoriteButtonToConversation(node);
      }
      const childrenToProcess = node.querySelectorAll(':scope > div.conversation[data-test-id="conversation"], :scope > .conversation-items-container > div.conversation[data-test-id="conversation"]');
      childrenToProcess.forEach(addFavoriteButtonToConversation);
    }
  });
}

// --- 初始化和等待逻辑 (与之前版本相同，使用 waitForElement) ---
function waitForElement(selectors, callback, timeout = 15000) { // Timeout 15s
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of selectorArray) {
        const element = document.querySelector(selector);
        if (element) {
            // console.log('Gemini Favorites: Element found immediately with selector:', selector, element);
            callback(element);
            return;
        }
    }
    let observer;
    let timeoutId;
    const cleanup = () => {
        if (observer) observer.disconnect();
        if (timeoutId) clearTimeout(timeoutId);
    };
    observer = new MutationObserver(() => {
        for (const selector of selectorArray) {
            const element = document.querySelector(selector);
            if (element) {
                // console.log('Gemini Favorites: Element found by MutationObserver with selector:', selector, element);
                cleanup();
                callback(element);
                return;
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // console.log('Gemini Favorites: Initial MutationObserver set up to find chat history container. Selectors:', selectors);
    if (timeout) {
        timeoutId = setTimeout(() => {
            let element = null;
            for (const selector of selectorArray) {
                element = document.querySelector(selector);
                if (element) break;
            }
            cleanup();
            if (element) {
                // console.log('Gemini Favorites: Element found by final check at timeout:', element);
                callback(element);
            } else {
                console.warn(`Gemini Favorites: Chat history container not found after ${timeout}ms using selectors:`, selectors);
                callback(null);
            }
        }, timeout);
    }
}

async function mainLogic(historyListContainer) {
    if (!historyListContainer) {
        console.warn("Gemini Favorites: Cannot proceed, historyListContainer is null.");
        return;
    }
    // console.log('Gemini Favorites: Chat history container successfully found:', historyListContainer);

    const allExistingItems = document.querySelectorAll('div.conversation[data-test-id="conversation"]');
    // console.log(`Gemini Favorites: Found ${allExistingItems.length} global conversation items before main observer setup.`);
    allExistingItems.forEach(addFavoriteButtonToConversation);

    const chatItemsObserver = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                processNewNodesInContainer(mutation.addedNodes);
            }
        }
    });
    chatItemsObserver.observe(historyListContainer, { childList: true, subtree: true });
    // console.log("Gemini Favorites: Main MutationObserver for chat items is now active on:", historyListContainer);

    const itemsInContainer = historyListContainer.querySelectorAll('div.conversation[data-test-id="conversation"]');
    itemsInContainer.forEach(addFavoriteButtonToConversation);
}

async function initializeExtension() {
    // console.log('Gemini Favorites: Initializing extension logic...');
    await loadFavorites();
    const containerSelectors = [
        '#conversations-list-2',
        'conversations-list div.conversations-container',
        '.chat-history-list div.conversations-container',
        'conversations-list',
        '.chat-history-list'
    ];
    waitForElement(containerSelectors, mainLogic, 15000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
  initializeExtension();
}