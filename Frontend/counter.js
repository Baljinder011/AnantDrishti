
function animateCounter(counter) {
    const target = +counter.getAttribute('data-target');
    let count = 0;

    const increment = target / 150; // Adjust for speed
    const speed = 20; // Interval speed in ms

    const updateCount = () => {
        count += increment;
        if (count < target) {
            counter.innerText = Math.floor(count);
            setTimeout(updateCount, speed);
        } else {
            counter.innerText = target >= 1000 ? `${Math.floor(target/1000)}K` : target;
            setTimeout(() => animateCounter(counter), 2000); // Restart after 2s
        }
    };

    updateCount();
}

document.addEventListener('DOMContentLoaded', () => {
    const counters = document.querySelectorAll('.counter');
    counters.forEach(counter => animateCounter(counter));
});