class OrderingApp {
    constructor() {
        this.pdfParser = new PDFParser();
        this.excelGenerator = new ExcelGenerator();
        this.items = [];

        this.state = {
            filter: 'ALL',
            search: '',
            validationMode: false,
            validationErrors: []
        };

        this.initializeElements();
        this.attachEventListeners();
    }

    initializeElements() {
        this.uploadZone = document.getElementById('uploadZone');
        this.fileInput = document.getElementById('fileInput');

        this.loadingEl = document.getElementById('loading');

        this.itemsContainer = document.getElementById('itemsContainer');
        this.itemsGrid = document.getElementById('itemsGrid');
        this.itemsCount = document.getElementById('itemsCount');

        this.summaryStats = document.getElementById('summaryStats');
        this.statAccepted = document.getElementById('statAccepted');
        this.statIncreased = document.getElementById('statIncreased');
        this.statDecreased = document.getElementById('statDecreased');

        this.submitContainer = document.getElementById('submitContainer');
        this.submitBtn = document.getElementById('submitBtn');

        // New Controls
        this.controlsContainer = document.getElementById('controlsContainer');
        this.searchInput = document.getElementById('searchInput');
        this.clearSearchBtn = document.getElementById('clearSearch');
        this.filterTabs = document.getElementById('filterTabs');
        this.validationBanner = document.getElementById('validationBanner');
        this.exitValidationBtn = document.getElementById('exitValidationBtn');

        // Resume Banner
        this.resumeBanner = document.getElementById('resumeBanner');
        this.resumeTimeEl = document.getElementById('resumeTime');
        this.btnResume = document.getElementById('btnResume');
        this.btnDiscard = document.getElementById('btnDiscard');

        // Check for saved session on load
        this.checkForSavedSession();
    }

    attachEventListeners() {
        this.uploadZone.addEventListener('click', (e) => {
            if (e.target !== this.fileInput) {
                this.fileInput.click();
            }
        });

        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];
                this.handleFileUpload(file);
            }
        });

        this.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadZone.classList.add('dragover');
        });

        this.uploadZone.addEventListener('dragleave', () => {
            this.uploadZone.classList.remove('dragover');
        });

        this.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadZone.classList.remove('dragover');

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.type === 'application/pdf') {
                    this.handleFileUpload(file);
                } else {
                    alert('Please upload a PDF file');
                }
            }
        });

        this.submitBtn.addEventListener('click', () => {
            this.generateExcel();
        });

        // Search Listener
        this.searchInput.addEventListener('input', (e) => {
            this.state.search = e.target.value.toLowerCase();
            this.displayItems();
            this.clearSearchBtn.style.display = this.state.search ? 'block' : 'none';
        });

        this.clearSearchBtn.addEventListener('click', () => {
            this.state.search = '';
            this.searchInput.value = '';
            this.displayItems();
            this.clearSearchBtn.style.display = 'none';
        });

        // Filter Tabs Listener
        this.filterTabs.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab')) {
                this.setFilter(e.target.dataset.filter);

                // Update active tab UI
                this.filterTabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
            }
        });

        // Exit Validation Mode Listener
        this.exitValidationBtn.addEventListener('click', () => {
            this.toggleValidationMode(false);
        });

        // Resume Session Listeners
        this.btnResume.addEventListener('click', () => {
            this.loadState();
        });

        this.btnDiscard.addEventListener('click', () => {
            this.clearState();
            this.resumeBanner.style.display = 'none';
        });
    }

    setFilter(filterType) {
        this.state.filter = filterType;
        this.displayItems();
    }

    toggleValidationMode(active, errors = []) {
        this.state.validationMode = active;
        this.state.validationErrors = active ? errors : [];

        if (active) {
            this.validationBanner.style.display = 'block';
            this.controlsContainer.style.display = 'none'; // Hide filters to focus on errors
            // Ensure we show ALL validation errors, so clear other filters
            this.state.filter = 'ALL';
            this.state.search = '';
            this.searchInput.value = '';
        } else {
            this.validationBanner.style.display = 'none';
            this.controlsContainer.style.display = 'block';
        }

        this.displayItems();
    }

    getRenderList() {
        if (this.state.validationMode) {
            // In validation mode, show only items that are in the error list
            return this.items.filter(item => this.state.validationErrors.includes(item.wrin));
        }

        return this.items.filter(item => {
            // 1. Filter by Category
            const matchesCategory = this.state.filter === 'ALL' || item.storageType === this.state.filter;

            // 2. Filter by Search (Name or WRIN)
            const term = this.state.search;
            const matchesSearch = !term || item.name.toLowerCase().includes(term) || item.wrin.includes(term);

            return matchesCategory && matchesSearch;
        });
    }

    async handleFileUpload(file) {
        // Check if there's an active session
        if (this.items.length > 0) {
            if (!confirm('Uploading a new file will clear your current session. Do you want to proceed?')) {
                this.fileInput.value = '';
                return;
            }
        }

        try {
            this.showLoading();
            this.hideUploadZone();
            this.resumeBanner.style.display = 'none'; // Hide resume banner if valid upload starts

            const newItems = await this.pdfParser.parsePDF(file);

            // Clear any old state first
            this.clearState();

            // Set and save new items
            this.items = newItems;
            this.pdfParser.items = newItems; // FIX: Sync parser items after clearState wiped them
            this.saveState();

            this.hideLoading();
            this.hideUploadZone(); // Ensure upload zone is hidden after clearState showed it

            this.displayItems();
            this.updateStats();

        } catch (error) {
            console.error('Error processing file:', error);
            alert(error.message || 'Error processing PDF. Please try again.');
            this.hideLoading();

            if (this.items.length === 0) {
                this.showUploadZone();
            }
        } finally {
            this.fileInput.value = '';
        }
    }

    displayItems() {
        this.itemsGrid.innerHTML = '';

        const renderList = this.getRenderList();

        if (renderList.length === 0) {
            this.itemsGrid.innerHTML = '<div class="no-results">No items found matching your criteria.</div>';
        } else {
            renderList.forEach(item => {
                const card = this.createItemCard(item);
                this.itemsGrid.appendChild(card);
            });
        }

        this.itemsCount.textContent = `${renderList.length} items visible`;
        this.itemsContainer.classList.add('active');
        this.summaryStats.classList.add('active');
        this.submitContainer.classList.add('active');

        if (!this.state.validationMode) {
            this.controlsContainer.style.display = 'block';
        }
    }

    createItemCard(item) {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.wrin = item.wrin;

        const stockValue = (item.actualStock !== null && item.actualStock !== undefined) ? item.actualStock : '';

        card.innerHTML = `
      <div class="item-header">
        <div class="item-wrin">WRIN: ${item.wrin}</div>
        <h3 class="item-name">${item.name}</h3>
        <span class="item-storage">${item.storageType}</span>
      </div>

      <div class="item-details">
        <div class="detail-item">
          <span class="detail-label">Proposed Qty</span>
          <span class="detail-value">${item.proposedQty}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">RSP</span>
          <span class="detail-value">${item.stock}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Transit</span>
          <span class="detail-value">${item.transit}</span>
        </div>
      </div>

      <div class="item-actions">
        <button class="btn btn-accept" data-action="accept">
          <span>✓ Accept</span>
        </button>
        <button class="btn btn-increase" data-action="increase">
          <span>↑ Increase</span>
        </button>
        <button class="btn btn-decrease" data-action="decrease">
          <span>↓ Decrease</span>
        </button>
      </div>

      <div class="stock-input-container" id="stock-${item.wrin}">
        <div class="input-group">
            <label for="input-${item.wrin}">Current Stock on Hand:</label>
            <input 
              type="number" 
              id="input-${item.wrin}" 
              placeholder="Enter stock"
              min="0"
              step="0.01"
              value="${stockValue}"
            />
        </div>
        <div class="input-group">
            <label for="reason-${item.wrin}">Reason for Change:</label>
            <select id="reason-${item.wrin}" class="reason-select">
                <option value="" disabled ${!item.reason ? 'selected' : ''}>Select a reason...</option>
                <option value="Stock On Hand Variance" ${item.reason === 'Stock On Hand Variance' ? 'selected' : ''}>Stock On Hand Variance</option>
                <option value="Manual Items" ${item.reason === 'Manual Items' ? 'selected' : ''}>Manual Items</option>
                <option value="Safety Stock" ${item.reason === 'Safety Stock' ? 'selected' : ''}>Safety Stock</option>
                <option value="Shelf Life" ${item.reason === 'Shelf Life' ? 'selected' : ''}>Shelf Life</option>
                <option value="Usage" ${item.reason === 'Usage' ? 'selected' : ''}>Usage</option>
            </select>
        </div>
      </div>
    `;

        const buttons = card.querySelectorAll('.btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = btn.dataset.action;
                this.handleItemAction(item.wrin, action, card);
            });
        });

        const input = card.querySelector(`#input-${item.wrin}`);
        input.addEventListener('input', (e) => {
            const val = e.target.value;
            const actualStock = val === '' ? null : parseFloat(val);

            // FIND REAL ITEM IN SOURCE OF TRUTH
            const realItem = this.items.find(i => i.wrin === item.wrin);
            if (realItem) {
                console.log('Auto-saving stock:', realItem.wrin, actualStock);
                this.pdfParser.updateItemStatus(realItem.wrin, realItem.status, actualStock, realItem.reason);
                this.saveState();
            }
        });

        const reasonSelect = card.querySelector(`#reason-${item.wrin}`);
        reasonSelect.addEventListener('change', (e) => {
            const reason = e.target.value;

            // FIND REAL ITEM IN SOURCE OF TRUTH
            const realItem = this.items.find(i => i.wrin === item.wrin);
            if (realItem) {
                console.log('Auto-saving reason:', realItem.wrin, reason);
                this.pdfParser.updateItemStatus(realItem.wrin, realItem.status, realItem.actualStock, reason);
                this.saveState();
            }
        });

        if (item.status === 'accept') {
            card.classList.add('status-accept');
            const acceptBtn = card.querySelector('[data-action="accept"]');
            if (acceptBtn) acceptBtn.classList.add('active');
        } else if (item.status === 'increase' || item.status === 'decrease') {
            card.classList.add(`status-${item.status}`);
            const actionBtn = card.querySelector(`[data-action="${item.status}"]`);
            if (actionBtn) actionBtn.classList.add('active');

            const stockInput = card.querySelector('.stock-input-container');
            if (stockInput) stockInput.classList.add('active');
        }

        return card;
    }

    handleItemAction(wrin, action, card) {
        const buttons = card.querySelectorAll('.btn');
        buttons.forEach(btn => btn.classList.remove('active'));

        const clickedBtn = card.querySelector(`[data-action="${action}"]`);
        clickedBtn.classList.add('active');

        card.className = 'item-card';
        card.classList.add(`status-${action}`);

        const stockInput = card.querySelector('.stock-input-container');
        if (action === 'increase' || action === 'decrease') {
            stockInput.classList.add('active');

            const input = card.querySelector(`#input-${wrin}`);
            const reasonSelect = card.querySelector(`#reason-${wrin}`);

            const actualStock = parseFloat(input.value) || null;
            const reason = reasonSelect.value;

            this.pdfParser.updateItemStatus(wrin, action, actualStock, reason);
        } else {
            stockInput.classList.remove('active');
            this.pdfParser.updateItemStatus(wrin, action);
        }

        this.updateStats();
        this.saveState();
    }

    updateStats() {
        const stats = this.pdfParser.getStats();

        this.statAccepted.textContent = stats.accepted;
        this.statIncreased.textContent = stats.increased;
        this.statDecreased.textContent = stats.decreased;

        this.submitBtn.disabled = this.items.length === 0;
    }

    async generateExcel() {
        try {
            const exportItems = this.pdfParser.getAdjustedItems();

            if (exportItems.length === 0) {
                alert('No items to export. Please adjust (Increase/Decrease) at least one item.');
                return;
            }

            // --- Validation Logic ---
            const invalidItems = [];
            exportItems.forEach(item => {
                const isMissingStock = item.actualStock === null || item.actualStock === undefined || isNaN(item.actualStock);

                // If it's Increase/Decrease, it MUST have a stock
                // If the stock input is invalid, add to error list
                if (isMissingStock) {
                    invalidItems.push(item.wrin);
                    return; // Skip reason check if stock is missing (prioritize stock)
                }

                // If it's Increase/Decrease, it MUST have a reason
                if (!item.reason || item.reason === '') {
                    invalidItems.push(item.wrin);
                }
            });

            if (invalidItems.length > 0) {
                // Activate Fail-Safe Mode
                this.toggleValidationMode(true, invalidItems);

                // Scroll to top to see banner
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }

            // --- Generation ---
            // const workbook = await this.excelGenerator.generateExcel(exportItems); // PREVIOUS LOGIC HAD DUPLICATE CALL
            const workbook = await this.excelGenerator.generateExcel(exportItems);
            await this.excelGenerator.downloadExcel(workbook);

        } catch (error) {
            console.error('Error generating Excel:', error);
            alert('Failed to generate Excel file. See console for details.');

            this.submitBtn.textContent = 'Generate Excel Spreadsheet';
            this.submitBtn.disabled = this.items.length === 0;
        }
    }

    showLoading() {
        this.loadingEl.classList.add('active');
    }

    hideLoading() {
        this.loadingEl.classList.remove('active');
    }

    showUploadZone() {
        this.uploadZone.style.display = 'block';
    }

    hideUploadZone() {
        this.uploadZone.style.display = 'none';
    }

    // --- Auto-Save Logic ---

    checkForSavedSession() {
        const savedData = localStorage.getItem('mbSync_data');
        if (savedData) {
            try {
                const parsed = JSON.parse(savedData);
                const date = new Date(parsed.timestamp);
                this.resumeTimeEl.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString();
                this.resumeBanner.style.display = 'block';
            } catch (e) {
                console.error('Error reading saved session', e);
                this.clearState();
            }
        }
    }

    saveState() {
        if (this.items.length === 0) return;

        const data = {
            timestamp: Date.now(),
            items: this.items,
            state: this.state
        };
        localStorage.setItem('mbSync_data', JSON.stringify(data));
    }

    loadState() {
        try {
            const savedData = localStorage.getItem('mbSync_data');
            if (!savedData) return;

            const parsed = JSON.parse(savedData);
            this.items = parsed.items;
            this.state = parsed.state || this.state;

            this.resumeBanner.style.display = 'none';
            this.hideUploadZone();
            this.displayItems();
            this.updateStats();

            // Restore PDF Parser items reference since it's used for stats calculation
            this.pdfParser.items = this.items;

        } catch (e) {
            console.error('Error loading state:', e);
            alert('Failed to load saved session.');
            this.clearState();
        }
    }

    clearState() {
        localStorage.removeItem('mbSync_data');
        this.items = [];
        this.pdfParser.items = [];
        this.showUploadZone();
        this.itemsContainer.classList.remove('active');
        this.summaryStats.classList.remove('active');
        this.submitContainer.classList.remove('active');
        this.controlsContainer.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    window.app = new OrderingApp();
});
