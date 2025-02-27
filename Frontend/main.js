// Function to fetch and render products
function fetchAndRenderProducts() {
    fetch("data.json")
        .then((response) => {
            if (!response.ok) {
                throw new Error("Failed to load products data.");
            }
            return response.json();
        })
        .then((products) => {
            const productsContainer = document.getElementById("products-container");
            products.forEach((product) => {
                const productCard = document.createElement("div");
                productCard.classList.add("three-products-1");
                productCard.innerHTML = `
                    <img src="${product.image}" alt="${product.name}">
                    <h5>${product.name}<br>${product.description}</h5>
                    <p>Price: $${product.price.toFixed(2)}</p>
                   <a href="The-Products.html"> <button class="btn btn-primary buy-now" data-id="${product.id}">Buy Now</button></a>
                `;
                productsContainer.appendChild(productCard);
            });

            // Add event listeners to "Buy Now" buttons
            const buyNowButtons = document.querySelectorAll(".buy-now");
            buyNowButtons.forEach((button) => {
                button.addEventListener("click", (event) => {
                    const productId = event.target.getAttribute("data-id");
                    const product = products.find((p) => p.id == productId);
                    if (product) {
                        // Save product details to sessionStorage
                        sessionStorage.setItem("selectedProduct", JSON.stringify(product));

                        // Redirect to the details page
                        window.location.href = "/details.html";
                    }
                });
            });
        })
        .catch((error) => {
            console.error("Error:", error);
            document.getElementById("products-container").innerHTML =
                "<p>Failed to load products. Please try again later.</p>";
        });
}

// Fetch and render products on DOM load
document.addEventListener("DOMContentLoaded", fetchAndRenderProducts);




