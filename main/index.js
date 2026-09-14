// The app's entry point (package.json "main"). main.js only defines things, so tools can load it
// without launching the app. Electron 44 doesn't set require.main to the entry file, so a
// `require.main === module` check there never ran and no window opened.
const {app} = require('electron')
const {prepareProfile} = require('./startup')

if (prepareProfile(app)) require('./main').start()
else app.quit()
