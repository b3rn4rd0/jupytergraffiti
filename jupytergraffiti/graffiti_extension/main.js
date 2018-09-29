define([
  'base/js/namespace',
  '/nbextensions/graffiti_extension/js/graffiti.js',
  '/nbextensions/graffiti_extension/js/utils.js'
], (Jupyter, Graffiti, utils) => {
  function load_ipython_extension() {
    console.log('Graffiti loaded:', Graffiti);
    window.Graffiti = Graffiti;
    Graffiti.init();
    utils.saveNotebook();

    Jupyter.notebook.events.on('kernel_restarting.Kernel', (e) => {
      console.log('Graffiti: kernel restarted, so rerunning require', e);
      require(['jupytergraffiti/js/loader.js']);
      utils.saveNotebook();
    });
  }

  return {
    load_ipython_extension: load_ipython_extension
  };
});
