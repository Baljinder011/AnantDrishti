// Place this in a separate JS file, e.g., search-manager.js
class SearchManager {
    constructor() {
        this.searchInput = null;
        this.suggestionBox = null;
        this.products = [];
    }

    async initializeSearch() {
        try {
            // Check for CONFIG and API_URL
            if (!window.CONFIG || !CONFIG.API_URL) {
                console.error('Configuration not found');
                return;
            }

            // Fetch products from API
            const response = await fetch(`${CONFIG.API_URL}/products`);
            this.products = await response.json();

            // Initialize search elements
            this.searchInput = document.getElementById('searchInput');
            this.suggestionBox = document.getElementById('suggestionBox');

            if (!this.searchInput || !this.suggestionBox) {
                console.warn('Search elements not found on this page');
                return;
            }

            // Setup event listeners
            this.setupEventListeners();
        } catch (error) {
            console.error('Error initializing search:', error);
        }
    }

    setupEventListeners() {
        // Input event for live suggestions
        this.searchInput.addEventListener('input', () => this.showSuggestions());

        // Enter key event for search
        this.searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.performSearch();
            }
        });

        // Click outside to hide suggestions
        document.addEventListener('click', (event) => {
            if (this.suggestionBox && this.searchInput &&
                !this.searchInput.contains(event.target) && 
                !this.suggestionBox.contains(event.target)) {
                this.suggestionBox.style.display = 'none';
            }
        });

        // Search icon click event
        const searchIcon = document.querySelector('.the-search');
        if (searchIcon) {
            searchIcon.addEventListener('click', () => this.performSearch());
        }
    }

    showSuggestions() {
        if (!this.searchInput || !this.suggestionBox) return;

        const query = this.searchInput.value.toLowerCase().trim();
        
        // Clear previous suggestions
        this.suggestionBox.innerHTML = '';
        
        // Hide suggestions if query is empty
        if (query === '') {
            this.suggestionBox.style.display = 'none';
            return;
        }

        // Filter products
        const filteredProducts = this.products.filter(product => 
            product.name.toLowerCase().includes(query)
        );

        // Render suggestions
        filteredProducts.forEach(product => {
            const suggestionItem = document.createElement('li');
            suggestionItem.className = 'list-group-item suggestion-item';

            // Create product image
            const productImage = document.createElement('img');
            productImage.src = product.image || '../Photos/placeholder.png';
            productImage.alt = product.name;
            productImage.className = 'product-image';

            // Create product name
            const productName = document.createElement('span');
            productName.textContent = product.name;
            productName.className = 'product-name';

            suggestionItem.appendChild(productImage);
            suggestionItem.appendChild(productName);

            // Click event to navigate to product
            suggestionItem.addEventListener('click', () => {
                this.navigateToProduct(product);
            });

            this.suggestionBox.appendChild(suggestionItem);
        });

        // Show or hide suggestion box
        this.suggestionBox.style.display = filteredProducts.length > 0 ? 'block' : 'none';
    }

    navigateToProduct(product) {
        // Construct query string with product details
        const queryParams = new URLSearchParams({
            id: product._id,
            name: product.name,
            category: product.category
        });

        // Navigate to product details page
        window.location.href = `./The-products.html?${queryParams.toString()}`;
    }

    performSearch() {
        if (!this.searchInput) return;

        const query = this.searchInput.value.toLowerCase().trim();
        
        if (query === '') {
            alert('Please enter a search term');
            return;
        }

        // Filter products
        const filteredProducts = this.products.filter(product => 
            product.name.toLowerCase().includes(query)
        );

        if (filteredProducts.length > 0) {
            // Redirect to products page with search query
            const searchParams = new URLSearchParams({ search: query });
            window.location.href = `./products.html?${searchParams.toString()}`;
        } else {
            alert('No products found matching your search');
        }
    }
}

// Universal initialization function
function initializeSearchOnPage() {
    const searchManager = new SearchManager();
    searchManager.initializeSearch();
}

// Initialize search when DOM is ready
document.addEventListener('DOMContentLoaded', initializeSearchOnPage);