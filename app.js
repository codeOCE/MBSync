class OrderingApp {
    constructor() {
        this.pdfParser = new PDFParser();
        this.excelGenerator = new ExcelGenerator();
        this.items = [];

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
    }

    async handleFileUpload(file) {
        try {
            this.showLoading();
            this.hideUploadZone();

            this.items = await this.pdfParser.parsePDF(file);

            this.hideLoading();

            this.displayItems();
            this.updateStats();

        } catch (error) {
            console.error('Error processing file:', error);
            alert(error.message || 'Error processing PDF. Please try again.');
            this.hideLoading();
            this.showUploadZone();
        } finally {
            this.fileInput.value = '';
        }
    }

    displayItems() {
        this.itemsGrid.innerHTML = '';

        this.items.forEach(item => {
            const card = this.createItemCard(item);
            this.itemsGrid.appendChild(card);
        });

        this.itemsCount.textContent = `${this.items.length} items found`;
        this.itemsContainer.classList.add('active');
        this.summaryStats.classList.add('active');
        this.submitContainer.classList.add('active');
    }

    createItemCard(item) {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.dataset.wrin = item.wrin;

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
            />
        </div>
        <div class="input-group">
            <label for="reason-${item.wrin}">Reason for Change:</label>
            <select id="reason-${item.wrin}" class="reason-select">
                <option value="" disabled selected>Select a reason...</option>
                <option value="Stock On Hand Variance">Stock On Hand Variance</option>
                <option value="Manual Items">Manual Items</option>
                <option value="Safety Stock">Safety Stock</option>
                <option value="Shelf Life">Shelf Life</option>
                <option value="Usage">Usage</option>
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
            const actualStock = parseFloat(e.target.value) || 0;
            const currentStatus = item.status;
            if (currentStatus === 'increase' || currentStatus === 'decrease') {
                this.pdfParser.updateItemStatus(item.wrin, currentStatus, actualStock, item.reason);
                this.updateStats();
            }
        });

        const reasonSelect = card.querySelector(`#reason-${item.wrin}`);
        reasonSelect.addEventListener('change', (e) => {
            const reason = e.target.value;
            const currentStatus = item.status;
            if (currentStatus === 'increase' || currentStatus === 'decrease') {
                this.pdfParser.updateItemStatus(item.wrin, currentStatus, item.actualStock, reason);
            }
        });

        if (item.status === 'accept') {
            card.classList.add('status-accept');
            const acceptBtn = card.querySelector('[data-action="accept"]');
            if (acceptBtn) {
                acceptBtn.classList.add('active');
            }
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

            const missingStock = exportItems.filter(item =>
                item.actualStock === null || item.actualStock === undefined || isNaN(item.actualStock)
            );

            if (missingStock.length > 0) {
                alert('Please enter the current stock for all items you want to adjust.');
                return;
            }

            const missingReason = exportItems.filter(item =>
                !item.reason || item.reason === ''
            );

            if (missingReason.length > 0) {
                alert('Please select a "Reason for Change" for all items you want to adjust.');
                return;
            }

            await this.excelGenerator.generateExcel(exportItems);

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
}

document.addEventListener('DOMContentLoaded', () => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    window.app = new OrderingApp();
});
