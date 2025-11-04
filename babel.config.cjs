module.exports = {
  presets: [
    ['@babel/preset-env', { 
      targets: { node: 'current' },
      modules: 'commonjs'
    }],
    '@babel/preset-typescript',
    '@babel/preset-react'
  ],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
  sourceType: 'module'
};
