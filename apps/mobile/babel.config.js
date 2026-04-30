module.exports = function (api) {
  api.cache(true);

  const isDev = process.env.NODE_ENV === "development";

  return {
    presets: ["babel-preset-expo"],
    plugins: [
      isDev && "react-refresh/babel",
      [
        "module-resolver",
        {
          root: ["./"],
          alias: { "@": "./src" },
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
        },
      ],
    ].filter(Boolean),
  };
};