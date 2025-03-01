document.addEventListener("DOMContentLoaded", function () {
    const searchInput = document.getElementById("searchInput");
    const searchSuggestions = document.getElementById("searchSuggestions");

    searchInput.addEventListener("input", async function () {
        const query = searchInput.value.trim();
        if (query.length === 0) {
            searchSuggestions.innerHTML = "";
            searchSuggestions.style.display = "none";
            return;
        }

        try {
            const response = await fetch(`${CONFIG.API_URL}/products/search?query=${query}`);
            const products = await response.json();
            
            searchSuggestions.innerHTML = "";
            if (products.length > 0) {
                products.forEach(product => {
                    const suggestionItem = document.createElement("div");
                    suggestionItem.classList.add("dropdown-item");
                    suggestionItem.textContent = product.name;
                    suggestionItem.addEventListener("click", () => {
                        searchInput.value = product.name;
                        searchSuggestions.innerHTML = "";
                        searchSuggestions.style.display = "none";
                        redirectToSearchResults(query);
                    });
                    searchSuggestions.appendChild(suggestionItem);
                });
                searchSuggestions.style.display = "block";
            } else {
                searchSuggestions.innerHTML = "<div class='dropdown-item'>No products found</div>";
                searchSuggestions.style.display = "block";
            }
        } catch (error) {
            console.error("Error fetching search results:", error);
        }
    });

    searchInput.addEventListener("keypress", function (event) {
        if (event.key === "Enter") {
            event.preventDefault();
            redirectToSearchResults(searchInput.value.trim());
        }
    });

    function redirectToSearchResults(query) {
        if (query.length > 0) {
            window.location.href = `./products.html?search=${encodeURIComponent(query)}`;
        }
    }
});

<script src="config.js"></script>
