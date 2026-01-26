// PDF Parser Module
// Extracts data from MB Sync PDF reports

class PDFParser {
    constructor() {
        this.items = [];
    }

    async parsePDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            let fullText = '';

            // Extract text from all pages
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();

                // Sort items by Y coordinate (descending) then X coordinate (ascending)
                // This ensures we read left-to-right, top-to-bottom
                const sortedItems = textContent.items.slice().sort((a, b) => {
                    const yDiff = b.transform[5] - a.transform[5]; // Y coordinate (inverted)
                    if (Math.abs(yDiff) > 5) { // Same line threshold
                        return yDiff;
                    }
                    return a.transform[4] - b.transform[4]; // X coordinate
                });

                // Preserve line breaks by detecting y-coordinate changes
                let pageText = '';
                let lastY = null;

                for (const item of sortedItems) {
                    const currentY = item.transform[5];

                    // If y-coordinate changed significantly, it's a new line
                    if (lastY !== null && Math.abs(currentY - lastY) > 5) {
                        pageText += '\n';
                    }
                    pageText += item.str + ' ';
                    lastY = currentY;
                }

                fullText += pageText + '\n';
            }

            // Parse the extracted text
            this.items = this.parseText(fullText);
            return this.items;

        } catch (error) {
            console.error('PDF parsing error:', error);
            throw new Error('Failed to parse PDF. Please ensure it is a valid MB Sync report.');
        }
    }

    parseText(text) {
        const items = [];
        const lines = text.split('\n');

        // Pattern to match item rows
        // Format: WRIN NAME PROPOSED_QTY ... STOCK ... STORAGE_TYPE
        // Example: 14836000 sour cream sauce 5 0.94 0.85 Refrigerated

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Skip empty lines and headers
            if (!line || line.includes('Order Status') || line.includes('WRIN NAME')) {
                continue;
            }

            // Match lines that start with a WRIN number (typically 6-8 digits)
            const wrinMatch = line.match(/^(\d{4,8})\s+(.+)/);

            if (wrinMatch) {
                const wrin = wrinMatch[1];
                const rest = wrinMatch[2];

                // Parse the rest of the line
                const parts = rest.split(/\s+/);

                // Extract name (everything before numbers start appearing)
                let nameEnd = 0;
                for (let j = 0; j < parts.length; j++) {
                    // Check if current part is a pure number
                    if (/^\d+(\.\d+)?$/.test(parts[j])) {
                        // Look ahead: If the NEXT part is text (not a number), then THIS number 
                        // is likely part of the name (e.g., "Tray 4 Cup").
                        // If the next part is ALSO a number, we assume we hit the data block (Qty, Price, etc).

                        const nextPart = parts[j + 1];
                        const nextIsNumber = nextPart && /^\d+(\.\d+)?$/.test(nextPart);

                        if (nextPart && !nextIsNumber) {
                            continue; // Valid part of name
                        }

                        // Otherwise, we assume this is the start of the numeric data
                        nameEnd = j;
                        break;
                    }
                }

                const name = parts.slice(0, nameEnd).join(' ');
                const numbers = parts.slice(nameEnd);

                // Extract storage type (last non-numeric part)
                let storageType = 'Unknown';
                const storageTypes = ['Refrigerated', 'Frozen', 'Dry', 'ManualItems'];
                for (const type of storageTypes) {
                    if (line.includes(type)) {
                        storageType = type;
                        break;
                    }
                }

                // Extract key numbers
                // Typical format: proposedQty ... stock ... (other numbers)
                // Fix: Check if numbers exists and has content
                const proposedQty = (numbers && numbers.length > 0) ? numbers[0] : '0';

                // Fix: Check length before accessing index 3
                const stock = (numbers && numbers.length > 3) ? numbers[3] : '0';

                // Only add if we have valid data
                if (name && wrin) {
                    items.push({
                        wrin,
                        name: this.cleanName(name),
                        proposedQty: parseFloat(proposedQty) || 0,
                        stock: parseFloat(stock) || 0,
                        storageType,
                        status: 'accept', // <--- CHANGED: Default to accept
                        actualStock: null,
                        adjustedQty: parseFloat(proposedQty) || 0 // <--- CHANGED: Set default adjusted qty
                    });
                }
            }
        }

        return items;
    }

    cleanName(name) {
        // Remove extra whitespace and clean up the name
        return name
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    getItems() {
        return this.items;
    }

    updateItemStatus(wrin, status, actualStock = null, reason = null) {
        const item = this.items.find(i => i.wrin === wrin);
        if (item) {
            item.status = status;
            item.actualStock = actualStock;
            item.reason = reason;

            // Calculate adjusted quantity
            if (status === 'increase' && actualStock !== null) {
                const difference = item.stock - actualStock;
                item.adjustedQty = Math.max(0, item.proposedQty + difference);
            } else if (status === 'decrease' && actualStock !== null) {
                const difference = actualStock - item.stock;
                item.adjustedQty = Math.max(0, item.proposedQty - difference);
            } else if (status === 'accept') {
                item.adjustedQty = item.proposedQty;
            }
        }
    }

    getAdjustedItems() {
        return this.items.filter(item =>
            item.status === 'increase' || item.status === 'decrease'
        );
    }

    getStats() {
        return {
            total: this.items.length,
            accepted: this.items.filter(i => i.status === 'accept').length,
            increased: this.items.filter(i => i.status === 'increase').length,
            decreased: this.items.filter(i => i.status === 'decrease').length,
            pending: this.items.filter(i => i.status === 'pending').length
        };
    }
}

// Export for use in main app
window.PDFParser = PDFParser;
