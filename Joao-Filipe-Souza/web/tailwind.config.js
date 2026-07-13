/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,jsx}"],
    theme: {
        extend: {
            colors: {
                ink: "#14213d",
                coral: "#e76f51",
                emerald: "#2a9d8f",
                amber: "#f4a261",
                mist: "#f6f7f9",
            },
            fontFamily: {
                display: ["Fraunces", "serif"],
                body: ["Inter Tight", "sans-serif"],
            },
            boxShadow: {
                soft: "0 10px 28px rgba(20, 33, 61, 0.08)",
            },
            keyframes: {
                "fade-up": {
                    "0%": { opacity: "0", transform: "translateY(10px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
            },
            animation: {
                "fade-up": "fade-up 550ms ease-out both",
            },
        },
    },
    plugins: [],
};
