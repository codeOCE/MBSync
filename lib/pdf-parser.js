// PDF Parser Module - Text Layout Strategy
// Reconstructs visual lines and parses via Regex
// Mimics 'pdftotext -layout' behavior for robustness

class PDFParser {
    constructor() {
        this.items = [];
    }

    async parsePDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const allTextLines = [];

            // 1. Reconstruct Text Lines from Geometry
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();

                // Sort items: Top to Bottom (Y desc), then Left to Right (X asc)
                const items = textContent.items;
                items.sort((a, b) => {
                    const yDiff = b.transform[5] - a.transform[5]; // Y is 5th element
                    if (Math.abs(yDiff) > 5) return yDiff; // Different lines
                    return a.transform[4] - b.transform[4]; // Same line, sort X
                });

                // Build Lines
                let currentY = null;
                let currentLineStr = "";
                let lastXWithWidth = 0;

                for (const item of items) {
                    const x = item.transform[4];
                    const y = item.transform[5];
                    const text = item.str;

                    if (!text.trim()) continue; // Skip pure whitespace tokens (we add our own spaces)

                    // Check for new line (vertical jump > 5 units)
                    if (currentY === null || Math.abs(y - currentY) > 5) {
                        if (currentLineStr.trim()) allTextLines.push(currentLineStr.trim());
                        currentLineStr = text;
                        currentY = y;
                        lastXWithWidth = x + item.width;
                    } else {
                        // Same line - calculate gap for spaces
                        const gap = x - lastXWithWidth;
                        // If gap is significant (e.g. > 4 units), add a space. 
                        // Visual spacing often > 10 for column separation.
                        if (gap > 4) {
                            currentLineStr += " " + text;
                        } else {
                            currentLineStr += text; // Merge close tokens (e.g. part of same word)
                        }
                        lastXWithWidth = x + item.width;
                    }
                }
                // Push last line of page
                if (currentLineStr.trim()) allTextLines.push(currentLineStr.trim());
            }

            // DEBUG: Log the full reconstructed text to console
            console.log('--- PDF RAW TEXT DUMP ---');
            console.log(allTextLines.join('\n'));
            console.log('-------------------------');

            // 2. Parse the Reconstructed Lines
            this.items = this.parseTextLines(allTextLines);
            return this.items;

        } catch (error) {
            console.error('PDF parsing error:', error);
            throw new Error('Failed to parse PDF. Please ensure it is a valid MB Sync report.');
        }
    }

    parseTextLines(lines) {
        const items = [];

        for (const line of lines) {
            // A. Skip Known Headers / Junk Lines
            // Filter out lines containing Header keywords
            if (/store\s*#|page\s*\d|report|user:|date:|time:|^processed/i.test(line)) continue;
            // Filter header row definition itself
            if (/^WRIN\s+Description/i.test(line)) continue;

            // B. Regex Parsing
            // Pattern: Start with 4-8 digit WRIN -> Space -> Name (greedy) -> Space -> Sequence of Numbers
            // B. Regex Parsing
            // Pattern: Start with 4-8 digit WRIN -> Space -> Name -> Space -> Data Section (Numbers + potential units)
            // We use a more permissive regex for the end part to catch "1.00 EA" or similar.
            const match = line.match(/^(\d{4,8})\s+(.+?)\s+([-\d\.,\s]+.*)$/);

            if (match) {
                const wrin = match[1];
                let name = match[2].trim();
                const rawDataStr = match[3].trim();

                // Extract only valid numbers from the data string
                // Split by spaces, filter for things that look like numbers
                const numberTokens = rawDataStr.split(/\s+/)
                    .map(n => n.replace(/,/g, '')) // Remove commas
                    .filter(n => /^-?\d+(\.\d+)?$/.test(n)); // Keep only valid numbers

                const dCount = numberTokens.length;

                // C. Column Mapping (Right-to-Left Rule) - UPDATED 7 Columns
                // 1. Last (dCount-1) = Safety Stock (Ignore)
                // 2. 2nd Last (dCount-2) = Stock Left (Ignore)
                // 3. 3rd Last (dCount-3) = Cycle Usage (Ignore)
                // 4. 4th Last (dCount-4) = Transit
                // 5. 5th Last (dCount-5) = RSP
                // 6. 6th Last (dCount-6) = Order Qty (Ignore)
                // 7. 7th Last (dCount-7) = Proposed Qty

                let proposedQty = 0;
                let rsp = 0;
                let transit = 0;

                // Access array from end using negative indices logic
                if (dCount >= 4) transit = parseFloat(numberTokens[dCount - 4]) || 0;
                if (dCount >= 5) rsp = parseFloat(numberTokens[dCount - 5]) || 0;
                if (dCount >= 7) proposedQty = parseFloat(numberTokens[dCount - 7]) || 0;

                // D. Extract Storage Type from Name
                let storageType = 'Unknown';
                const storageKeywords = ['Refrigerated', 'Frozen', 'Dry', 'ManualItems'];

                for (const key of storageKeywords) {
                    if (name.includes(key)) {
                        storageType = key;
                        break;
                    }
                }

                items.push({
                    wrin,
                    name: this.cleanName(name),
                    proposedQty,
                    stock: rsp, // Mapping RSP to 'stock' field for display
                    transit,
                    storageType,
                    status: 'neutral', // Initial state
                    actualStock: null,
                    adjustedQty: proposedQty,
                    reason: ''
                });
            }
        }
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
        // Only explicitly changed items
        return this.items.filter(item =>
            item.status === 'increase' || item.status === 'decrease'
        );
    }

    getExportItems() {
        // Return all items, mapping neutral -> accept
        return this.items.map(item => ({
            ...item,
            status: item.status === 'neutral' ? 'accept' : item.status
        }));
    }

    getStats() {
        return {
            total: this.items.length,
            accept: this.items.filter(i => i.status === 'accept' || i.status === 'neutral').length,
            increase: this.items.filter(i => i.status === 'increase').length,
            decrease: this.items.filter(i => i.status === 'decrease').length
        };
    }
}
