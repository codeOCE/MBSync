// PDF Parser Module
// Extracts data from MB Sync PDF reports using Geometric Alignment & Fallback
// Uses X-coordinates to correctly map Name, Prop Qty, and Stock, ignoring other numbers.

class PDFParser {
    constructor() {
        this.items = [];
    }

    async parsePDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            const allLines = [];

            // Extract text with coordinates from all pages
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();

                // Sort items by Y (descending) then X (ascending)
                const sortedItems = textContent.items.slice().sort((a, b) => {
                    const yDiff = b.transform[5] - a.transform[5];
                    if (Math.abs(yDiff) > 5) return yDiff;
                    return a.transform[4] - b.transform[4];
                });

                // Group into lines
                let currentLine = [];
                let lastY = null;

                for (const item of sortedItems) {
                    const currentY = item.transform[5];
                    const text = item.str;
                    if (!text.trim()) continue; // Skip empty whitespace items

                    if (lastY !== null && Math.abs(currentY - lastY) > 5) {
                        // New Line
                        if (currentLine.length > 0) allLines.push(currentLine);
                        currentLine = [];
                    }

                    currentLine.push({
                        text: text.trim(),
                        x: item.transform[4],
                        width: item.width,
                        y: currentY
                    });

                    lastY = currentY;
                }
                if (currentLine.length > 0) allLines.push(currentLine);
            }

            this.items = this.parseGeometrically(allLines);
            return this.items;

        } catch (error) {
            console.error('PDF parsing error:', error);
            throw new Error('Failed to parse PDF. Please ensure it is a valid MB Sync report.');
        }
    }

    parseGeometrically(lines) {
        const items = [];

        // 2. Parse Items
        for (const line of lines) {
            try {
                if (line.length < 2) continue; // Need at least WRIN and Name

                const fullLineText = line.map(t => t.text).join(' ');

                // IGNORE HEADERS: Skip lines that look like page headers/footers
                if (/store\s*#|page\s*\d|report|date:|time:/i.test(fullLineText)) {
                    continue;
                }

                // Relaxed WRIN Check: Look for WRIN in first 3 tokens
                let wrinToken = null;
                let wrinIndex = -1;

                for (let k = 0; k < Math.min(3, line.length); k++) {
                    const t = line[k];
                    // WRIN: 4-8 digits. 
                    // Verify it's NOT a small integer like "1" or "2" (common in headers) unless it's clearly code-like
                    if (/^(\d{4,8})$/.test(t.text) || /^\d{4,8}/.test(t.text)) {
                        // Double check it's not part of a date (e.g. 2024)
                        // MB Sync WRINs are usually non-date-like, but 2024 could be a valid WRIN? 
                        // Usually WRINs are unique. Let's assume valid.
                        wrinToken = t;
                        wrinIndex = k;
                        break;
                    }
                }

                if (!wrinToken) continue; // No WRIN found in start of line

                const wrinMatch = wrinToken.text.match(/^(\d{4,8})/);
                const wrin = wrinMatch ? wrinMatch[1] : wrinToken.text.split(' ')[0];

                // Collect all numbers in the line that are NOT the WRIN
                const numberTokens = line.filter(t => /^\d+(\.\d+)?$/.test(t.text));

                // Clean valid numbers: must be to right of WRIN token
                const validNumbers = numberTokens.filter(t => t.x > wrinToken.x + wrinToken.width);

                let proposedQty = '0';
                let rsp = '0';
                let transit = '0';

                // Identify "Real Data Numbers" by checking context
                const realDataNumbers = [];
                for (let j = 0; j < validNumbers.length; j++) {
                    const numTok = validNumbers[j];
                    const tokenIndex = line.indexOf(numTok);
                    const nextToken = line[tokenIndex + 1];

                    let isNameNum = false;
                    if (nextToken) {
                        // If next token is text (not number), then this number is part of name
                        if (!/^\d+(\.\d+)?$/.test(nextToken.text)) {
                            isNameNum = true;
                        }
                    }

                    if (!isNameNum) {
                        realDataNumbers.push(numTok);
                    }
                }

                // --- USER MAPPING (Strict 6-Column Right-to-Left) ---
                // 1. Last = Stock Left (Ignore)
                // 2. 2nd Last = Cycle Usage (Ignore)
                // 3. 3rd Last = Transit
                // 4. 4th Last = RSP (System Stock)
                // 5. 5th Last = Order Qty (Ignore)
                // 6. 6th Last = Proposed Qty

                const dCount = realDataNumbers.length;

                if (dCount >= 3) transit = realDataNumbers[dCount - 3].text;
                if (dCount >= 4) rsp = realDataNumbers[dCount - 4].text;
                // index dCount - 5 is Order Qty (Ignore)
                if (dCount >= 6) proposedQty = realDataNumbers[dCount - 6].text;


                // Determine Name Split Point
                // Name is everything to the LEFT of the first Real Data Number.
                // If no data numbers, everything is Name.
                let splitX = 99999;
                if (realDataNumbers.length > 0) {
                    splitX = realDataNumbers[0].x;
                }

                // Construct Name
                let nameStrParts = [];
                let storageType = 'Unknown';

                for (const t of line) {
                    if (t === line[0]) continue; // Skip WRIN

                    // Add buffer -5 to avoid merging barely-touching items
                    if (t.x < splitX - 5) {
                        // Check storage keywords
                        if (['Refrigerated', 'Frozen', 'Dry', 'ManualItems'].some(s => t.text.includes(s))) {
                            storageType = t.text;
                        } else {
                            nameStrParts.push(t.text);
                        }
                    }
                }

                // Fallback storage check
                if (storageType === 'Unknown') {
                    const sFound = line.find(t => ['Refrigerated', 'Frozen', 'Dry', 'ManualItems'].some(k => t.text.includes(k)));
                    if (sFound) {
                        storageType = sFound.text;
                    }
                }

                const name = nameStrParts.join(' ');

                // Filter removed: include all items
                if (name && wrin) {
                    items.push({
                        wrin,
                        name: this.cleanName(name),
                        proposedQty: parseFloat(proposedQty) || 0,
                        stock: parseFloat(rsp) || 0,
                        transit: parseFloat(transit) || 0,
                        storageType,
                        status: 'neutral', // Default to neutral (visually unselected)
                        actualStock: null,
                        adjustedQty: parseFloat(proposedQty) || 0,
                        reason: ''
                    });
                }
            } catch (err) {
                console.warn('Skipping malformed line:', err);
            }
        } // end loop

        return items;
    }

    cleanName(name) {
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

            if (status === 'increase' && actualStock !== null) {
                const diff = item.stock - actualStock;
                item.adjustedQty = Math.max(0, item.proposedQty + diff);
            } else if (status === 'decrease' && actualStock !== null) {
                const diff = actualStock - item.stock;
                item.adjustedQty = Math.max(0, item.proposedQty - diff);
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

    getExportItems() {
        return this.items.map(item => ({
            ...item,
            status: item.status === 'neutral' ? 'accept' : item.status
        }));
    }

    getStats() {
        return {
            total: this.items.length,
            accept: this.items.filter(i => i.status === 'accept').length,
            increase: this.items.filter(i => i.status === 'increase').length,
            decrease: this.items.filter(i => i.status === 'decrease').length
        };
    }
}
