define([
  'base/js/dialog',
  './LZString.js',
  './state.js',
  './utils.js',
  './audio.js',
  './storage.js',
  'components/marked/lib/marked'
], function(dialog, LZString, state, utils, audio, storage, marked) {
  const Graffiti = (function() {
    const graffiti = {

      init: () => {
        console.log('Graffiti: Main constructor running.');
        
        utils.loadCss([
          'jupytergraffiti/css/graffiti.css',
          'jupytergraffiti/css/font-awesome.min.css'
        ]);

        const location = document.location;

        state.init();
        const currentAccessLevel = state.getAccessLevel();
        if (currentAccessLevel === 'create') { // this should never happen, ie accessLevel of create should never be the default
          audio.init(state);
        }

        graffiti.LZString = LZString;
        graffiti.rewindAmt = 2; /*seconds */
        graffiti.CMEvents = {};
        graffiti.sitePanel = $('#site');
        graffiti.notebookPanel = $('#notebook');
        graffiti.notebookContainer = $('#notebook-container');

        graffiti.storageInProcess = false;
        graffiti.highlightMarkText = undefined;
        graffiti.cmLineHeight = 17.0001; // line height of code mirror lines as styled in Jupyter
        graffiti.cmLineFudge = 8; // buffer between lines
        graffiti.tokenRanges = {};
        graffiti.canvases = {};
        graffiti.lastUpdateControlsTime = utils.getNow();
        graffiti.notificationMsgs = {};
        graffiti.panelFadeTime = 350;

        storage.loadManifest(currentAccessLevel).then(() => {
          graffiti.initInteractivity()
        }).catch(() => {
          console.log('Not setting up Graffiti because this notebook has never had any authoring done yet (no recordingId).');
        });
      },

      provideAPIKeyExamples: () => {
        let recorderApiKeyCell = Jupyter.notebook.insert_cell_below('code');
        let invocationLine = "jupytergraffiti.api.play_recording('" + graffiti.recordingAPIKey + "')\n" +
                             "# jupytergraffiti.api.play_recording_with_prompt('" + graffiti.recordingAPIKey +
                             "', '![idea](../images/lightbulb_small.jpg) Click **here** to learn more.')\n" +
                             "# jupytergraffiti.api.stop_playback()";
        recorderApiKeyCell.set_text(invocationLine);          
        Jupyter.notebook.select_next();
      },

      bindControlPanelCallbacks: (parent, callbacks) => {
        if (callbacks !== undefined) {
          let cb, id, elem;
          for (cb of callbacks) {
            for (id of cb.ids) {
              parent.find('#' + id).on(cb.event, cb.fn);
            }
          }
        }
      },

      setNotifier: (notificationMsg, callbacks) => {
        const notifierPanel = graffiti.controlPanelIds['graffiti-notifier'];
        notifierPanel.show().children().hide();
        if (!graffiti.notificationMsgs.hasOwnProperty(notificationMsg)) {
          const notificationId = 'graffiti-notification-' + utils.generateUniqueId();
          const notificationHtml = $('<div id="' + notificationId + '">' + notificationMsg + '</div>');
          notificationHtml.appendTo(notifierPanel);
          const newNotificationDiv = notifierPanel.find('#' + notificationId);
          graffiti.notificationMsgs[notificationMsg] = newNotificationDiv;
          graffiti.bindControlPanelCallbacks(newNotificationDiv, callbacks);
        }
        graffiti.notificationMsgs[notificationMsg].show();
      },

      startPanelDragging: (e) => {
        console.log('Graffiti: dragging control panel');
        const controlPanelPosition = graffiti.outerControlPanel.position();
        const pointerPosition = state.getPointerPosition();
        state.setControlPanelDragging(true);
        state.setControlPanelDragOffset({ left: pointerPosition.x - controlPanelPosition.left, top: pointerPosition.y - controlPanelPosition.top });
        e.preventDefault();
        e.stopPropagation();
      },
      
      setupOneControlPanel: (elemId,elemHtml, callbacks) => {
        if (graffiti.controlPanelIds === undefined) {
          graffiti.controlPanelIds = {};
        }
        const fullHtml = '<div class="graffiti-control-panel" id="' + elemId +'">' + elemHtml + '</div>';
        const elem = $(fullHtml);
        elem.appendTo(graffiti.controlPanelsShell);
        graffiti.controlPanelIds[elemId] = graffiti.controlPanelsShell.find('#' + elemId);
        graffiti.bindControlPanelCallbacks(graffiti.controlPanelIds[elemId], callbacks);
      },

      setupControlPanels: () => {
        const outerControlPanel = $('<div id="graffiti-outer-control-panel">' +
                                    '  <div class="graffiti-small-dot-pattern" id="graffiti-drag-handle">&nbsp;</div>' +
                                    '  <div id="graffiti-control-panels-shell"></div>' +
                                    '</div>');
        //const header = $('#header');
        outerControlPanel.appendTo($('body'));
        const graffitiCursor = $('<i id="graffiti-cursor" name="cursor" class="graffiti-cursor"><img src="jupytergraffiti/css/transparent_bullseye2.png"></i>');
        graffitiCursor.appendTo(header);
        graffiti.graffitiCursor = $('#graffiti-cursor');

        graffiti.outerControlPanel = $('#graffiti-outer-control-panel');
        graffiti.outerControlPanel.hide();
        graffiti.controlPanelsShell = $('#graffiti-control-panels-shell');

        $('body').on('mouseup', (e) => {
          if (state.getControlPanelDragging()) {
            console.log('Graffiti: no longer dragging control panel');
            state.setControlPanelDragging(false);
            e.preventDefault();
            e.stopPropagation();
          }
        });

        const logoText = 'Graffiti'.split('').join('&nbsp;&nbsp;&nbsp;&nbsp;');
        graffiti.setupOneControlPanel('graffiti-control-panel-title', logoText);

        const dragHandle = $('#graffiti-drag-handle,#graffiti-control-panel-title');
        dragHandle.on('mousedown', (e) => {
          graffiti.startPanelDragging(e); 
        });

        graffiti.setupOneControlPanel('graffiti-record-controls', 
                                      '  <button class="btn btn-default" id="btn-create-graffiti">' +
                                      '<i class="fa fa-pencil"></i>&nbsp; <span>Create</span></button>' +
                                      '  <button class="btn btn-default" id="btn-edit-graffiti" title="Edit Graffiti movie">' +
                                      '<i class="fa fa-pencil"></i>&nbsp; <span>Edit</span></button>' +
                                      '  <button class="btn btn-default" id="btn-begin-recording" title="Record movie">' +
                                      '<i class="fa fa-film recorder-button"></i>&nbsp;<span>Record</span></button>' +
                                      '  <button class="btn btn-default" id="btn-begin-rerecording" title="ReRecord movie">' +
                                      '<i class="fa fa-film recorder-button"></i>&nbsp;<span>Rerecord</span></button>' +
                                      '  <button class="btn btn-default" id="btn-remove-graffiti" title="Remove Graffiti">' +
                                      '<i class="fa fa-trash"></i></button>',
                                      [
                                        {
                                          ids: ['btn-create-graffiti', 'btn-edit-graffiti'],
                                          event: 'click',
                                          fn: (e) => {
                                            graffiti.editGraffiti('graffiting');
                                          }
                                        },
                                        {
                                          ids: ['btn-begin-recording', 'btn-begin-rerecording'],
                                          event: 'click',
                                          fn: (e) => {
                                            graffiti.beginMovieRecordingProcess();
                                          }
                                        },
                                        {
                                          ids: ['btn-remove-graffiti'],
                                          event: 'click',
                                          fn: (e) => {
                                            graffiti.removeGraffitiWithPrompt();
                                          }
                                        },
                                      ]
        );

        graffiti.setupOneControlPanel('graffiti-finish-edit-controls', 
                                      '<button class="btn btn-default" id="btn-finish-graffiti" title="Save Graffiti">Save Graffiti</button>',
                                      [
                                        {
                                          ids: ['btn-finish-graffiti'],
                                          event: 'click',
                                          fn: (e) => {
                                            graffiti.finishGraffiti(true);
                                          }
                                        }
                                      ]
        );

        graffiti.setupOneControlPanel('graffiti-start-recording-controls', 
                                      '<button class="btn btn-default" id="btn-start-recording" title="Start recording">' +
                                      '<i class="fa fa-pause recorder-start-button"></i>&nbsp;Start Recording</button>',
                                      [
                                        {
                                          ids: ['btn-start-recording', 'btn-restart-recording'],
                                          event: 'click',
                                          fn: (e) => {
                                            graffiti.finishGraffiti(true);
                                          }
                                        }
                                      ]
        );

        graffiti.setupOneControlPanel('graffiti-recording-controls', 
                                      '<button class="btn btn-default" id="btn-end-recording" title="End recording">' +
                                      '<i class="fa fa-pause recorder-stop-button"></i>&nbsp;End Recording</button>' +
                                      '<div id="graffiti-recording-status">' +
                                      '  <div id="graffiti-recording-flash-icon"></div>' +
                                      '  <div id="graffiti-time-display-recording"></div>' +
                                      '</div>',
                                      [
                                        {
                                          ids: ['btn-end-recording'],
                                          event: 'click',
                                          fn: (e) => {
                                            graffiti.toggleRecording();
                                          }
                                        }
                                      ]
        );

        graffiti.setupOneControlPanel('graffiti-playback-controls', 
                                      '<div id="graffiti-playback-buttons">' +
                                      '  <button class="btn btn-default btn-play" id="btn-play" title="Start playback">' +
                                      '    <i class="fa fa-play"></i>' +
                                      '  </button>' +
                                      '  <button class="btn btn-default recorder-hidden" id="btn-pause" title="Pause playback">' +
                                      '    <i class="fa fa-pause"></i>' +
                                      '  </button>' +
                                      '  <div id="graffiti-skip-buttons">' +
                                      '    <button class="btn btn-default btn-rewind" id="btn-rewind" title="Skip back ' + graffiti.rewindAmt + ' seconds">' +
                                      '      <i class="fa fa-backward"></i>' +
                                      '    </button>' +
                                      '    <button class="btn btn-default btn-forward" id="btn-forward" title="Skip forward ' + graffiti.rewindAmt + ' seconds">' +
                                      '      <i class="fa fa-forward"></i>' +
                                      '    </button>' +
                                      '  </div>' +
                                      '  <div id="graffiti-sound-buttons">' +
                                      '    <button class="btn btn-default btn-sound-on" id="btn-sound-on" title="mute">' +
                                      '       <i class="fa fa-volume-up"></i>' +
                                      '   </button>' +
                                      '   <button class="btn btn-default btn-sound-off recorder-hidden" id="btn-sound-off" title="unmute">' +
                                      '     <i class="fa fa-volume-off"></i>' +
                                      '   </button>' +
                                      '  </div>' +
                                      '</div>' +
                                      '<div id="graffiti-scrub-controls">' +
                                      '  <div id="graffiti-playback-range">' +
                                      '    <input title="scrub" type="range" min="0" max="1000" value="0" id="graffiti-recorder-range"></input>' +
                                      '  </div>' +
                                      '  <div id="graffiti-time-display-playback">00:00</div>' +
                                      '</div>',
                                      [
                                        {
                                          ids: ['btn-play', 'btn-pause'],
                                          event: 'click',
                                          fn: (e) => {
                                            graffiti.togglePlayback();
                                          }
                                        },
                                        { 
                                          ids: ['btn-forward','btn-rewind'],
                                          event: 'click',
                                          fn: (e) => {
                                            console.log('btn-forward/btn-rewind clicked');
                                            let direction = 1;
                                            if (($(e.target).attr('id') === 'btn-rewind') || ($(e.target).hasClass('fa-backward'))) {
                                              direction = -1;
                                            }
                                            graffiti.jumpPlayback(direction);
                                          }
                                        },
                                        {
                                          ids: ['btn-sound-on', 'btn-sound-off'],
                                          event: 'click',
                                          fn: (e) => {
                                            if (state.getMute()) {
                                              state.setMute(false);
                                              graffiti.updateControlPanels();
                                              if (state.getActivity() === 'playing') {
                                                audio.startPlayback(state.getTimePlayedSoFar());
                                              }
                                            } else {
                                              state.setMute(true);
                                              graffiti.updateControlPanels();
                                              if (state.getActivity() === 'playing') {
                                                audio.pausePlayback();
                                              }
                                            }
                                          }
                                        },
                                        {
                                          ids: ['graffiti-recorder-range'],
                                          event: 'mousedown',
                                          fn: (e) => {
                                            //console.log('slider:mousedown');
                                            graffiti.pausePlayback(); // stop playback if playing when you start to scrub
                                            graffiti.clearAllCanvases();
                                            graffiti.changeActivity('scrubbing');
                                          }
                                        },
                                        {
                                          ids: ['graffiti-recorder-range'],
                                          event: 'mouseup',
                                          fn: (e) => {
                                            //console.log('slider:mouseup')
                                            graffiti.changeActivity('playbackPaused');
                                            graffiti.updateAllGraffitiDisplays();
                                          }
                                        },
                                        {
                                          ids: ['graffiti-recorder-range'],
                                          event: 'input',
                                          fn: (e) => {
                                            graffiti.handleSliderDrag(e);
                                          }
                                        }
                                      ]
        );
        
        graffiti.setupOneControlPanel('graffiti-notifier', 
                                      '<div id="graffiti-notifier"></div>');


        graffiti.setupOneControlPanel('graffiti-hot-tip',
                                      '<div id ="graffiti-hot-tip"><div>Hot Tip!</div></div>'
        );

        graffiti.setupOneControlPanel('graffiti-access-api',
                                      '<button class="btn btn-default" id="graffiti-access-api" title="Access API"></i>&nbsp; <span>Access API</span></button>',
                                      [
                                        { 
                                          ids: ['graffiti-access-api'],
                                          event: 'click', 
                                          fn: (e) => { 
                                            console.log('Graffiti: API key is:', graffiti.recordingAPIKey);
                                            graffiti.provideAPIKeyExamples();
                                          }
                                        }
                                      ]
        );
        

      },

      showControlPanels: (panels) => {
        graffiti.controlPanelsShell.children().hide();
        graffiti.controlPanelIds['graffiti-control-panel-title'].show(); // the title bar is always shown
        for (controlPanelId of panels) {
          // console.log('Graffiti: showing panel:', controlPanelId);
          graffiti.controlPanelIds[controlPanelId].show();
        }
      },


      updateControlPanels: (cm) => {
        // When we transition to a new state, control panel tweaks need to be made
        const activity = state.getActivity();
        const accessLevel = state.getAccessLevel();
        const outerControlHidden = graffiti.outerControlPanel.css('display') === 'none';
        // console.log('updateControlPanels, activity:', activity);
        if (accessLevel === 'view') {
          if (activity !== 'idle') {
            if (outerControlHidden) {
              graffiti.outerControlPanel.fadeIn(graffiti.panelFadeTime);
            }
          } else if ((state.getPlayableMovie('tip') === undefined) && 
                     (state.getPlayableMovie('api') === undefined) && 
                     (state.getPlayableMovie('cursorActivity') === undefined)) {
            if (!outerControlHidden) {
              graffiti.outerControlPanel.fadeOut(graffiti.panelFadeTime);
            }
            return;
          }
        } else {
          if (outerControlHidden) {
            graffiti.outerControlPanel.fadeIn(graffiti.panelFadeTime);
          }
        }

        switch (activity) {
          case 'idle':
            // Check if anchor or head of current selection is inside an existing recording token set. Controls will be different if so.
            let activeCell;
            if (cm === undefined) {
              activeCell = Jupyter.notebook.get_selected_cell();
            } else {
              activeCell = utils.findCellByCodeMirror(cm);
            }
            graffiti.selectedTokens = utils.findSelectionTokens(activeCell, graffiti.tokenRanges, state);
            graffiti.highlightIntersectingGraffitiRange();
            let visibleControlPanels;
            if (graffiti.selectedTokens.noTokensPresent) {
              console.log('no tokens');
              visibleControlPanels = ['graffiti-notifier']; // hide all control panels if in view only mode and not play mode
              graffiti.setNotifier('<div>Click in any text in a code cell to create or modify Graffiti\'s.</div>');
            } else if (accessLevel === 'view') {
              console.log('view only');
              visibleControlPanels = ['graffiti-playback-controls']; // hide all control panels if in view only mode and not play mode
            } else {
              visibleControlPanels = ['graffiti-record-controls'];
              graffiti.controlPanelIds['graffiti-record-controls'].find('#btn-begin-recording').show().
                       parent().find('#btn-begin-rerecording').hide().
                       parent().find('#btn-remove-graffiti').hide();
              graffiti.controlPanelIds['graffiti-record-controls'].
                       find('#btn-create-graffiti').show().
                       parent().find('#btn-edit-graffiti').hide();
              if (graffiti.selectedTokens.isIntersecting) {
                console.log('Graffiti: tweaking recording controls');
                graffiti.highlightIntersectingGraffitiRange();
                graffiti.controlPanelIds['graffiti-record-controls'].
                         find('#btn-create-graffiti').hide().
                         parent().find('#btn-edit-graffiti').show().
                         parent().find('#btn-remove-graffiti').show();
                //console.log('selectedTokens:', graffiti.selectedTokens);
                state.clearPlayableMovie('cursorActivity');
                if (graffiti.selectedTokens.hasMovie) {
                  state.setPlayableMovie('cursorActivity', graffiti.selectedTokens.recordingCellId,graffiti.selectedTokens.recordingKey);
                  graffiti.recordingAPIKey = graffiti.selectedTokens.recordingCellId.replace('id_','') + '_' + 
                                             graffiti.selectedTokens.recordingKey.replace('id_','');
                  visibleControlPanels.push('graffiti-access-api');
                  visibleControlPanels.push('graffiti-notifier');
                  //console.log('this recording has a movie');
                  graffiti.controlPanelIds['graffiti-record-controls'].find('#btn-begin-recording').hide().parent().find('#btn-begin-rerecording').show();
                  graffiti.setNotifier('<div>You can <span class="graffiti-notifier-link" id="graffiti-idle-play-link">play</span> this movie any time.</div>',
                                       [
                                         {
                                           ids: ['graffiti-idle-play-link'],
                                           event: 'click',
                                           fn: (e) => {
                                             graffiti.loadAndPlayMovie('cursorActivity');
                                           }
                                         },
                                       ]);
                }
              }
            }
            graffiti.showControlPanels(visibleControlPanels);
            break;
          case 'playing':
            graffiti.controlPanelIds['graffiti-playback-controls'].find('#btn-play').hide().parent().find('#btn-pause').show();
            if (state.getMute()) {
              graffiti.controlPanelIds['graffiti-playback-controls'].find('#btn-sound-on').hide().parent().find('#btn-sound-off').show();
            } else {
              graffiti.controlPanelIds['graffiti-playback-controls'].find('#btn-sound-off').hide().parent().find('#btn-sound-on').show();
            }
            graffiti.showControlPanels(['graffiti-playback-controls']);
            graffiti.setNotifier('<div><span class="graffiti-notifier-link" id="graffiti-pause-link">Pause</span> to interact w/Notebook, or</div>' +
                                 '<div><span class="graffiti-notifier-link" id="graffiti-cancel-playback-link">Cancel</span> movie playback</div>',
                                 [
                                   {
                                     ids: ['graffiti-pause-link'],
                                     event: 'click',
                                     fn: (e) => {
                                       graffiti.togglePlayback();
                                     }
                                   },
                                   {
                                     ids: ['graffiti-cancel-playback-link'],
                                     event: 'click',
                                     fn: (e) => {
                                       graffiti.cancelPlayback({cancelAnimation:true});
                                     }
                                   }
                                 ]);
            break;
          case 'playbackPaused':
            graffiti.controlPanelIds['graffiti-playback-controls'].find('#btn-pause').hide().parent().find('#btn-play').show();
            if (state.getSetupForReset()) {
              graffiti.setNotifier('<div><span class="graffiti-notifier-link" id="graffiti-restart-play-link">Play movie again</span>, or</div>' +
                                   '<div><span class="graffiti-notifier-link" id="graffiti-cancel-playback-link">Cancel</span> movie playback</div>',
                                   [
                                     {
                                       ids: ['graffiti-restart-play-link'],
                                       event: 'click',
                                       fn: (e) => {
                                         graffiti.togglePlayback();
                                       }
                                     },
                                     {
                                       ids: ['graffiti-cancel-playback-link'],
                                       event: 'click',
                                       fn: (e) => {
                                         graffiti.cancelPlayback({cancelAnimation:true});
                                       }
                                     }
                                   ]);
            } else {
              graffiti.setNotifier('<div><span class="graffiti-notifier-link" id="graffiti-continue-play-link">Continue</span> movie playback, or</div>' +
                                   '<div><span class="graffiti-notifier-link" id="graffiti-cancel-playback-link">Cancel</span> movie playback</div>',
                                   [
                                     {
                                       ids: ['graffiti-continue-play-link'],
                                       event: 'click',
                                       fn: (e) => {
                                         graffiti.togglePlayback();
                                       }
                                     },
                                     {
                                       ids: ['graffiti-cancel-playback-link'],
                                       event: 'click',
                                       fn: (e) => {
                                         graffiti.cancelPlayback({cancelAnimation:true});
                                       }
                                     }
                                   ]);
            }
            break;
          case 'graffiting':
            graffiti.showControlPanels(['graffiti-finish-edit-controls']);
            graffiti.setNotifier('<div>Enter the markdown you want to be displayed in the Graffiti and then click "Save Graffiti"  (or just run the label cell).</div>' +
                                 '<div>Or, <span class="graffiti-notifier-link" id="graffiti-cancel-graffiting-link">Cancel changes</span></div>',
                                 [
                                   {
                                     ids: ['graffiti-cancel-graffiting-link'],
                                     event: 'click',
                                     fn: (e) => {
                                       graffiti.finishGraffiti(false);
                                     }
                                   }
                                 ]);
            break;
          case 'recordingLabelling':
            graffiti.showControlPanels(['graffiti-start-recording-controls']);
            graffiti.setNotifier('<div>Enter markdown to describe your movie, then click "Start Recording" (or just run the label cell).</div>' +
                                 '<div>Or, <span class="graffiti-notifier-link" id="graffiti-cancel-recording-labelling-link">Cancel changes</span></div>',
                                 [
                                   {
                                     ids: ['graffiti-cancel-recording-labelling-link'],
                                     event: 'click',
                                     fn: (e) => {
                                       graffiti.finishGraffiti(false);
                                     }
                                   }
                                 ]);
            break;
          case 'recordingPending':
            graffiti.showControlPanels([]);
            graffiti.setNotifier('<div>Click in any code cell to begin recording your movie.</div>' +
                                 '<div>Or, <span class="graffiti-notifier-link" id="graffiti-cancel-recording-pending-link">Cancel recording</span></div>',
                                 [
                                   {
                                     ids: ['graffiti-cancel-recording-pending-link'],
                                     event: 'click',
                                     fn: (e) => {
                                       graffiti.finishGraffiti(false);
                                     }
                                   }
                                 ]);
            break;
          case 'recording':
            graffiti.showControlPanels(['graffiti-recording-controls']);
            graffiti.setNotifier('<div>Your activities are being recorded.' + 
                                 'Press ESC or click <span class="graffiti-notifier-link" id="graffiti-end-recording-link">End Recording</span> ' +
                                 'to end recording.</div>' +
                                 '<div>Or, <span class="graffiti-notifier-link" id="graffiti-cancel-recording-link">Cancel recording</span></div>',
                                 [
                                   {
                                     ids: ['graffiti-end-recording-link'],
                                     event: 'click',
                                     fn: (e) => {
                                       graffiti.toggleRecording();
                                     }
                                   },
                                   {
                                     ids: ['graffiti-cancel-recording-link'],
                                     event: 'click',
                                     fn: (e) => {
                                       graffiti.finishGraffiti(false);
                                     }
                                   }
                                 ]);
            break;
        }
      },

      updateControlPanelPosition: () => {
        if (state.getControlPanelDragging()) {
          const position = state.getPointerPosition();
          const offset = state.getControlPanelDragOffset();
          const newPosition =   { left: Math.max(0,position.x - offset.left), top: Math.max(0,position.y - offset.top) };
          const newPositionPx = { top: newPosition.top + 'px', left: newPosition.left + 'px' };
          graffiti.outerControlPanel.css(newPositionPx);
        }
      },

      initInteractivity: () => {
        audio.setAudioStorageCallback(storage.storeMovie);
        graffiti.addCMEvents();
        setTimeout(() => { 
          graffiti.setupBackgroundEvents();
        }, 500); // this timeout avoids too-early rendering of hidden recorder controls

        graffiti.refreshAllGraffitiHighlights();
        graffiti.refreshGraffitiTips();
        graffiti.setupControlPanels();
        graffiti.updateControlPanels();
      },

      // Inspired by https://www.codicode.com/art/how_to_draw_on_a_html5_canvas_with_a_mouse.aspx
      // and : http://perfectionkills.com/exploring-canvas-drawing-techniques/

      placeCanvas: (cellId, canvasType) => {
        if (graffiti.canvases[cellId] !== undefined) {
          //console.log('not adding ' + canvasType + ' canvas to this cell, already exists.');
          return;
        }
        const cell = utils.findCellByCellId(cellId);
        const cellElement = $(cell.element[0]);
        const canvasClass = 'recorder-canvas-' + canvasType;
        const existingCanvas = cellElement.find('.' + canvasClass);
        const cellRect = cellElement[0].getBoundingClientRect();
        $('<div class="recorder-canvas-outer"><canvas /></div>').appendTo(cellElement);
        const newCellCanvasDiv = cellElement.find('.recorder-canvas-outer:first');
        const newCellCanvas = newCellCanvasDiv.find('canvas')[0];
        const ctx =  newCellCanvas.getContext("2d");

        const canvasStyle = {
          width: cellRect.width + 'px',
          height: cellRect.height + 'px'
        };
        newCellCanvasDiv.css(canvasStyle);
        newCellCanvas.width = cellRect.width;
        newCellCanvas.height = cellRect.height;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        graffiti.canvases[cellId] = {
          div: newCellCanvasDiv,
          canvas: newCellCanvas,
          ctx: ctx,
          cellRect: cellRect
        };
      },
      
      setCanvasStyle: (cellId, canvasType) => {
        const canvas = graffiti.canvases[cellId];
        const ctx = canvas.ctx;
        if (canvasType === 'highlight') {
          ctx.strokeStyle = 'rgb(255,255,0)';
          ctx.shadowColor = 'rgb(255,255,0)';
          ctx.lineWidth = 15;
          ctx.shadowBlur = 35;
          ctx.globalAlpha = 0.5;
        } else { // lines are default although if erase activated, we will ignore this style and use clearRect
          ctx.strokeStyle = 'rgb(0,0,0)';
          ctx.shadowColor = 'rgb(0,0,0)';
          ctx.shadowBlur = 1;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 1.0;
        }
      },

      clearCanvas: (cellId) => {
        const canvas = graffiti.canvases[cellId];
        const ctx = canvas.ctx;
        const cellRect = canvas.cellRect;
        ctx.clearRect(0, 0, cellRect.width, cellRect.height);
      },
      
      clearAllCanvases: () => {
        for (let cellId of Object.keys(graffiti.canvases)) {
          graffiti.clearCanvas(cellId);
        }
      },

      updateGarnishDisplay: (cellId, ax, ay, bx, by, garnishStyle) => {
        //console.log('updateGarnishDisplay');
        if (graffiti.canvases.hasOwnProperty(cellId)) {
          const ctx = graffiti.canvases[cellId].ctx;
          if (garnishStyle === 'erase') {
            const eraseBuffer = 25;
            ctx.clearRect(ax - eraseBuffer / 2, ay - eraseBuffer / 2, eraseBuffer, eraseBuffer);
          } else {
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.closePath();
            ctx.stroke();
          }          
        }
      },

      updateGarnishDisplayIfRecording: (ax, ay, bx, by, viewInfo) => {
        if (state.getActivity() === 'recording') {
          const lastGarnishInfo = state.getLastGarnishInfo();
          if (viewInfo.garnishing) {
            graffiti.placeCanvas(viewInfo.cellId, viewInfo.garnishStyle);
            graffiti.setCanvasStyle(viewInfo.cellId, viewInfo.garnishStyle);
            const cellRect = viewInfo.cellRect;
            graffiti.updateGarnishDisplay(viewInfo.cellId, 
                                          ax - cellRect.left,
                                          ay - cellRect.top, 
                                          bx - cellRect.left,
                                          by - cellRect.top,
                                          viewInfo.garnishStyle);
            state.setLastGarnishInfo(bx, by, viewInfo.garnishing, viewInfo.garnishStyle, viewInfo.cellId);
          } else {
            // finished garnishing so set this garnish to fade out, if it's a highlighting garnish. line garnishes don't fade
            if (lastGarnishInfo.garnishing) {
              state.setLastGarnishInfo(bx, by, viewInfo.garnishing, viewInfo.garnishStyle, viewInfo.cellId);
            }
          }
        }
      },

      // extract any tooltip commands
      extractTooltipCommands: (markdown) => {
        const commandParts = markdown.match(/^%%(([^\s]*)\s(.*))$/mg);
        let partsRecord;
        if (commandParts === null)
          return undefined;
        if (commandParts.length > 0) {
          partsRecord = {
            buttonName: undefined,
            captionPic: '',
            caption: ''
          };
          let parts;
          for (let i = 0; i < commandParts.length; ++i) {
            parts = commandParts[i].match(/^(\S+)\s(.*)/).slice(1);
            switch (parts[0].toLowerCase()) {
              case '%%button_name':
                partsRecord.buttonName = parts[1];
                break;
              case '%%caption_pic':
                partsRecord.captionPic = utils.renderMarkdown(parts[1]);
                break;
              case '%%caption':
                partsRecord.caption = parts[1];
                break;
            }
          }
        }
        return partsRecord;
      },

      // Refresh the markDoc calls for any particular cell based on recording data

      // ******************************************************************************************************************************************
      // we should store the ranges we get back for the recordings so we can tell if the cursor is in any of them on cursorActivity
      // ******************************************************************************************************************************************

      refreshGraffitiHighlights: (params) => {
        const recordings = state.getManifestRecordingsForCell(params.cell.metadata.cellId);
        const cm = params.cell.code_mirror;
        const marks = cm.getAllMarks();
        let markClasses;
        if (params.clear) {
          for (let mark of marks) {
            mark.clear();
          }
        } else {
          markClasses = marks.map((mark) => { return mark.className }).join(' ').replace(/graffiti-highlight /g, '');
        }
        const allTokens = utils.collectCMTokens(cm);
        const cellId = params.cell.metadata.cellId;
        graffiti.tokenRanges[cellId] = {};
        if (recordings !== undefined) {
          if (Object.keys(recordings).length > 0) {
            let keyParts,recording, recordingKey, tokens, firstToken, marker, range;
            for (recordingKey of Object.keys(recordings)) {
              recording = recordings[recordingKey];
              tokens = recording.tokens;
              //console.log('recordingKey:', recordingKey);
              range = utils.getCMTokenRange(cm, tokens, allTokens);
              if (range !== undefined) {
                // Store computed character ranges for checking selections against recording ranges.
                graffiti.tokenRanges[cellId][recordingKey] = range;
                if (params.clear || (!params.clear && markClasses !== undefined && markClasses.indexOf(recordingKey) === -1)) {
                  // don't call markText twice on a previously marked range
                  marker = 'an-' + recording.cellId + '-' + recordingKey;
                  cm.markText({ line:range.start.line, ch:range.start.ch},
                              { line:range.end.line,   ch:range.end.ch  },
                              { className: 'graffiti-highlight ' + marker });
                }
              }
            }
          }
        }
      },

      refreshAllGraffitiHighlights: () => {
        const cells = Jupyter.notebook.get_cells();
        for (let cell of cells) {
          graffiti.refreshGraffitiHighlights({ cell: cell, clear: true });
        }
      },

      hideTip: (tip) => {
        graffiti.notebookContainer.find('.graffiti-tip').hide();
        state.clearPlayableMovie('tip');
      },

      refreshGraffitiTips: () => {
        const tips = $('.graffiti-highlight');
        //console.log('tips:', tips);
        //console.log('refreshGraffitiTips: binding mousenter/mouseleave');
        tips.unbind('mouseenter mouseleave').bind('mouseenter mouseleave', (e) => {
          const highlightElem = $(e.target);
          const idMatch = highlightElem.attr('class').match(/an-(id_.[^\-]+)-(id_[^\s]+)/);
          if (idMatch !== undefined) {
            const cellId = idMatch[1];
            const recordingKey = idMatch[2];
            const hoverCell = utils.findCellByCellId(cellId);
            const hoverCellElement = hoverCell.element[0];
            const hoverCellElementPosition = $(hoverCellElement).position();
            const outerInputElement = $(hoverCellElement).find('.CodeMirror-lines');
            const recording = state.getManifestSingleRecording(cellId, recordingKey);
            let existingTip = graffiti.notebookContainer.find('.graffiti-tip');
            if (e.type === 'mouseleave') {
              state.setTipTimeout(() => { graffiti.hideTip(); }, 500);
            } else {
              const currentPointerPosition = state.getPointerPosition();
              // Only show tip if cursor rests on hover for a 1/2 second
              state.setTipTimeout(() => {
                const newPointerPosition = state.getPointerPosition();
                const cursorDistanceSquared = (newPointerPosition.x - currentPointerPosition.x) * (newPointerPosition.x - currentPointerPosition.x) +
                                               (newPointerPosition.y - currentPointerPosition.y) * (newPointerPosition.y - currentPointerPosition.y);

                //console.log('comparing currentPointerPosition, newPointerPosition:', currentPointerPosition,
                //            newPointerPosition, cursorDistanceSquared);
                if (cursorDistanceSquared > 2000) {
                  state.clearTipTimeout();
                } else {
                  // const markdown = marked("## Header 2\n### Header3\nSee more [**details of defining keyboard shortcuts**](http://google.com) " +
                  // "below.\n\n Let's go to [**Udacity**](https://udacity.com).");
                  let contentMarkdown = '';
                  //console.log('markId:', markId, 'recordings:', hoverCell.metadata.recordings);
                  const tooltipCommands = graffiti.extractTooltipCommands(recording.markdown);
                  let headlineMarkdown = '';
                  if (tooltipCommands !== undefined) {
                    headlineMarkdown = '<div class="headline">' +
                                       ' <div>' + tooltipCommands.captionPic + '</div><div>' + tooltipCommands.caption + '</div>' +
                                       '</div>';
                  }
                  if (recording !== undefined) {
                    contentMarkdown = utils.renderMarkdown(recording.markdown)
                  }
                  let tooltipContents = headlineMarkdown + '<div class="parts">' + '<div class="info">' + contentMarkdown + '</div>';
                  if (recording.hasMovie) {
                    const buttonName = (((tooltipCommands !== undefined) && (tooltipCommands.buttonName !== undefined)) ? tooltipCommands.buttonName : 'Play Movie');
                    state.setPlayableMovie('tip', cellId, recordingKey);
                    tooltipContents +=
                      '   <div class="movie"><button class="btn btn-default btn-small" id="moviePlay">' + buttonName + '</button></div>';
                  }
                  tooltipContents += '</div>';

                  if (existingTip.length === 0) {
                    existingTip = $('<div class="graffiti-tip" id="graffiti-tip">' + tooltipContents + '</div>')
                      .prependTo(graffiti.notebookContainer);
                    existingTip.bind('mouseenter mouseleave', (e) => {
                      //console.log(e.type === 'mouseenter' ? 'entering tooltip' : 'leaving tooltip');
                      if (e.type === 'mouseenter') {
                        state.clearTipTimeout();
                      } else {
                        graffiti.hideTip();
                      }
                    });
                  } else {
                    existingTip.find('#moviePlay').unbind('click');
                    existingTip.html(tooltipContents);
                  }
                  existingTip.find('#moviePlay').click((e) => {
                    //console.log('click in tip');
                    state.clearTipTimeout();
                    e.stopPropagation(); // for reasons unknown even still propogates to the codemirror editing area undeneath
                    graffiti.loadAndPlayMovie('tip');
                    return false;
                  });
                  const outerInputOffset = outerInputElement.offset();
                  const highlightElemOffset = highlightElem.offset();
                  const existingTipHeight = existingTip.height();
                  const tipLeft = parseInt(Math.min(outerInputElement.width() - existingTip.width(),
                                                    Math.max(highlightElemOffset.left, outerInputOffset.left)));
                  const tipPosition = { left: tipLeft,
                                        top: parseInt(highlightElemOffset.top - outerInputOffset.top) - existingTipHeight - 20 };
                  //console.log('outerInputOffset:', outerInputOffset, 'highlightElemOffset:', highlightElemOffset, 'tipPosition:', tipPosition);
                  //console.log('tipPosition.top:', tipPosition.top);
                  const highlightElemRect = highlightElem[0].getBoundingClientRect();
                  const headerRect = $('#header')[0].getBoundingClientRect();
                  // if the highlight element is in the upper half of the notebook panel area. flip the tooltip to be below the highlightElem
                  const rectDifference = highlightElemRect.top - headerRect.bottom - 20;
                  if (rectDifference < existingTipHeight ) {
                    tipPosition.top = highlightElemOffset.top - outerInputOffset.top + graffiti.cmLineHeight + graffiti.cmLineFudge;
                  }
                  tipPosition.top += hoverCellElementPosition.top;
                  const positionPx = { left: tipPosition.left + 'px', top: tipPosition.top + 'px' };
                  existingTip.css(positionPx);
                  existingTip.show();
                }
              }, 425); // this number is how long user has to hover before we display the tooltip
            }
          }
        });
      },

      setupBackgroundEvents: () => {
        // Handle rubber banding scrolling that occurs on short notebooks so cursor doesn't look wrong (possibly, only chrome?).
        console.log('Graffiti: setupBackgroundEvents');

        graffiti.sitePanel.on('scroll', (e) => {
          const notebookPanelHeight = graffiti.notebookPanel.height();
          const viewInfo = utils.collectViewInfo(state.getPointerPosition().y,
                                                 graffiti.notebookPanel.height(),
                                                 graffiti.sitePanel.scrollTop(),
                                                 state.getGarnishing(),
                                                 state.getGarnishStyle());
          state.storeViewInfo(viewInfo);
          state.storeHistoryRecord('scroll');
          if (state.getActivity() === 'playbackPaused') {
            graffiti.graffitiCursor.hide();            
          }
          return true;
        });

        $('body').keydown((e) => {
          const activity = state.getActivity();
          let stopProp = false;
          //console.log('keydown e:', e);
          switch (e.which) {
            case 32: // space key stops playback
              if (activity === 'playing') {
                stopProp = true;
                graffiti.togglePlayback();
              }
              break;
            case 27: // escape key stops playback, cancels pendingRecording, and completes regular recording in process
              stopProp = true;
              switch (activity) {
                case 'recording':
                  graffiti.toggleRecording();
                  break;
                case 'recordingPending':
                  graffiti.changeActivity('idle');
                  break;
                case 'playing':
                case 'playbackPaused':
                  graffiti.cancelPlayback({cancelAnimation:true});
                  break;
              }
              break;
              //          case 13: // enter key
              //            break;
            case 18:
              if (activity === 'recording') {
                console.log('Start highlight garnishing.');
                state.setGarnishing(true);
                (e.metaKey) ? state.setGarnishStyle('erase') : state.setGarnishStyle('highlight');
                stopProp = true;
              }
              break;
            case 91:
              if (activity === 'recording') {
                console.log('Start line garnishing.');
                state.setGarnishing(true);
                (e.altKey) ? state.setGarnishStyle('erase') : state.setGarnishStyle('line');
                stopProp = true;
              }
              break;
            default:
              break; // let other keys pass through
          }
          
          if (stopProp) {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }

          return true;
        });

        $('body').keyup( (e) => {
          // any keyup turns off garnishing
          state.setGarnishing(false);
        });

        graffiti.sitePanel.on('click', (e) => {
          //console.log('notebook panel click event:',e);
          const target = $(e.target);
          //graffiti.handleControlsClick(target);
          return true;
        });

        window.onmousemove = (e) => {
          //console.log('cursorPosition:[',e.clientX, e.clientY, ']');
          //console.log('mouse_e:', e.pageX, e.pageY);
          const previousPointerPosition = state.getPointerPosition();
          const previousPointerX = previousPointerPosition.x;
          const previousPointerY = previousPointerPosition.y;
          state.storePointerPosition( e.clientX, e.clientY ); // keep track of current pointer position at all times
          const viewInfo = utils.collectViewInfo(e.clientY, 
                                                 graffiti.notebookPanel.height(), 
                                                 graffiti.sitePanel.scrollTop(),
                                                 state.getGarnishing(),
                                                 state.getGarnishStyle());
          state.storeViewInfo(viewInfo);
          state.storeHistoryRecord('pointer');
          graffiti.updateGarnishDisplayIfRecording(previousPointerX, previousPointerY, e.clientX, e.clientY, viewInfo );
          graffiti.updateControlPanelPosition();
          return true;
        };

        // if we were playing a recording when they hit reload, we need to cancel it, restore, and save before we continue
        window.onbeforeunload = (e) => {
          graffiti.cancelPlaybackNoVisualUpdates();
        };

        console.log('Graffiti: Background setup complete.');
      },

      storeRecordingInfoInCell: () => {
        let recordingRecord, newRecording, recordingCell, recordingCellId, recordingKey;
        if (graffiti.selectedTokens.isIntersecting) { 
          // Prepare to update existing recording
          recordingCell = graffiti.selectedTokens.recordingCell;
          recordingCellId = graffiti.selectedTokens.recordingCellId;
          recordingKey = graffiti.selectedTokens.recordingKey;
          recordingRecord = state.getManifestSingleRecording(recordingCellId, recordingKey);
          newRecording = false;
        } else { 
          // Prepare to create a new recording
          recordingCell = Jupyter.notebook.get_selected_cell();
          recordingCellId = recordingCell.metadata.cellId;
          recordingKey = utils.generateUniqueId();
          newRecording = true;
          recordingRecord = {
            cellId: recordingCellId,
            createDate: utils.getNow(),
            inProgress: true,
            tokens: $.extend({}, graffiti.selectedTokens.tokens),
            markdown: '',
            authorId: state.getAuthorId(),
            authorType: state.getAuthorType(), // one of "creator" (eg teacher), "viewer" (eg student)
            hasMovie: false
          }
          // Store recording info in the manifest
          state.setSingleManifestRecording(recordingCellId, recordingKey, recordingRecord);
        }

        state.storeRecordingCellInfo({
          newRecording: newRecording,
          recordingRecord: recordingRecord,
          recordingCell: recordingCell,
          recordingCellId: recordingCellId,
          recordingKey: recordingKey,
          scrollTop: graffiti.sitePanel.scrollTop()
        });

        return recordingCell;
      },

      clearHighlightMarkText: () => {
        if (graffiti.highlightMarkText !== undefined) {
          graffiti.highlightMarkText.clear();
          graffiti.highlightMarkText = undefined;
        }
      },

      highlightIntersectingGraffitiRange: () => {
        graffiti.clearHighlightMarkText();
        if (state.getAccessLevel() === 'view') { // we never do this in view mode
          return;
        }
        const cell = graffiti.selectedTokens.recordingCell;
        if (cell !== undefined) {
          const cm = cell.code_mirror;
          const startLoc = cm.posFromIndex(graffiti.selectedTokens.start);
          const endLoc = cm.posFromIndex(graffiti.selectedTokens.end);
          graffiti.highlightMarkText = cm.markText(startLoc, endLoc, { className: 'graffiti-selected' });
        }
      },

      editGraffiti: (newActivity) => {
        graffiti.changeActivity(newActivity);
        state.setLastEditActivityTime();
        graffiti.storeRecordingInfoInCell();

        const activeCellIndex = Jupyter.notebook.get_selected_index();
        const graffitiEditCell = Jupyter.notebook.insert_cell_above('markdown');

        graffitiEditCell.metadata.cellId = utils.generateUniqueId();
        utils.refreshCellMaps();
        let editableText;
        if (graffiti.selectedTokens.isIntersecting) {
          editableText = graffiti.selectedTokens.markdown; // use whatever author put into this graffiti previously
        } else {
          editableText = graffiti.selectedTokens.tokens.allTokensString;
        }

        graffitiEditCell.set_text(editableText);
        graffitiEditCell.unrender();
        Jupyter.notebook.scroll_to_cell(Math.max(0,activeCellIndex),500);
        const selectedCell = Jupyter.notebook.get_selected_cell();
        selectedCell.unselect();
        graffitiEditCell.select();
        graffitiEditCell.code_mirror.focus();
        graffitiEditCell.code_mirror.execCommand('selectAll');

        graffiti.graffitiEditCellId = graffitiEditCell.metadata.cellId;
      },

      finishGraffiti: (doSave) => {
        const activity = state.getActivity();
        if (activity !== 'graffiting' && activity !== 'recordingLabelling') {
          return;
        }

        const recordingCellInfo = state.getRecordingCellInfo();
        const recordingCell = recordingCellInfo.recordingCell;

        const editCellIndex = utils.findCellIndexByCellId(graffiti.graffitiEditCellId);

        let editCellContents = '';
        if (editCellIndex !== undefined) {
          const editCell = utils.findCellByCellId(graffiti.graffitiEditCellId);
          editCellContents = editCell.get_text();
          Jupyter.notebook.delete_cell(editCellIndex);

          // Save the graffiti text into the right cell recording.
          const recordings = state.getManifestRecordingsForCell(recordingCellInfo.recordingCellId);
          if (doSave) {
            if (recordingCellInfo.newRecording) {
              recordings[recordingCellInfo.recordingKey] = recordingCellInfo.recordingRecord;
            }
            recordings[recordingCellInfo.recordingKey].markdown = editCellContents;
          } else {
            if (recordingCellInfo.newRecording) {
              state.removeManifestEntry(recordingCellInfo.recordingCellId, recordingCellInfo.recordingKey);
            }
          }
        }
        storage.storeManifest();
        utils.saveNotebook();

        // need to reselect graffiti text that was selected in case it somehow got unselected
        //recordingCell.code_mirror.setSelections(recordingCellInfo.selections);
        graffiti.sitePanel.animate({ scrollTop: recordingCellInfo.scrollTop}, 500);
        if (doSave && state.getActivity() === 'recordingLabelling') {
          graffiti.setPendingRecording();
        } else {
          graffiti.changeActivity('idle');
          recordingCell.code_mirror.focus();
          graffiti.refreshGraffitiHighlights({cell: recordingCell, clear: false});
          graffiti.refreshGraffitiTips();
        }
      },

      removeGraffitiCore: (recordingCell, recordingKey) => {
        const recordingCellId = recordingCell.metadata.cellId;
        storage.deleteMovie(recordingCellId, recordingKey);
      },


      removeAllGraffitis: () => {
        const manifest = state.getManifest(); // save manifest before we wipe it out
        state.setManifest({});
        let recordingCellId, recordingCell, recordingIds, recordingKeys, destructions = 0;
        for (recordingCellId of Object.keys(manifest)) {
          console.log('Removing recordings from cell:', recordingCellId);
          recordingKeys = Object.keys(manifest[recordingCellId]);
          if (recordingKeys.length > 0) {
            recordingCell = utils.findCellByCellId(recordingCellId);
            for (recordingKey of recordingKeys) {
              console.log('Removing recording id:', recordingKey);
              destructions++;
              graffiti.removeGraffitiCore(recordingCell, recordingKey);
              graffiti.refreshGraffitiHighlights({cell: recordingCell, clear: true});
            }
          }
        }
        storage.storeManifest();
        graffiti.highlightIntersectingGraffitiRange();
        graffiti.refreshGraffitiTips();
        graffiti.updateControlPanels();
        utils.saveNotebook();

        dialog.modal({
          title: 'Your notebook is now cleaned of all graffiti.',
          body: 'We removed ' + destructions + ' graffitis. Feel free to create new ones.',
          sanitize:false,
          buttons: {
            'OK': {
              click: (e) => {
                console.log('You clicked ok, you want to remove ALL graffitis');
              }
            }
          }
        });

      },

      removeGraffiti: (recordingCell, recordingKey) => {
        graffiti.removeGraffitiCore(recordingCell, recordingKey);
        if (state.removeManifestEntry(recordingCell.metadata.cellId, recordingKey)) {
          graffiti.highlightIntersectingGraffitiRange();
          graffiti.refreshGraffitiHighlights({cell: recordingCell, clear: true});
          graffiti.refreshGraffitiTips();
          storage.storeManifest();
          utils.saveNotebook();
          graffiti.updateControlPanels();
        }
      },

      removeAllGraffitisWithConfirmation: () => {
        dialog.modal({
          title: 'Are you sure you want to remove ALL graffitis from this notebook?',
          body: 'Note: this cannot be undone.',
          sanitize:false,
          buttons: {
            'OK': {
              click: (e) => {
                console.log('You clicked ok, you want to remove ALL graffitis');
                graffiti.removeAllGraffitis();

              }
            },
            'Cancel': { click: (e) => { console.log('you cancelled:', $(e.target).parent()); } },
          }
        });

      },

      removeGraffitiWithPrompt: () => {
        if (graffiti.selectedTokens.isIntersecting) {
          const recordingCell = graffiti.selectedTokens.recordingCell;
          const recordingCellId = recordingCell.metadata.cellId;
          const recordingKey = graffiti.selectedTokens.recordingKey;
          const recording = state.getManifestSingleRecording(recordingCellId,recordingKey);
          const content = '(Please Note: this cannot be undone.)<br/>' +
                          '<b>Graffiti\'d text:</b><span class="graffiti-text-display">' + recording.tokens.allTokensString + '</span><br/>' +
                          '<b>Graffiti contents:</b>' + utils.renderMarkdown(recording.markdown) + '<br/>';
          
          const confirmModal = dialog.modal({
            title: 'Are you sure you want to remove this Graffiti?',
            body: content,
            sanitize:false,
            buttons: {
              'OK': {
                click: (e) => {
                  console.log('you clicked ok, you want to remove graffiti:',
                              $(e.target).parent());
                  graffiti.removeGraffiti(recordingCell, recordingKey);

                }
              },
              'Cancel': { click: (e) => { console.log('you cancelled:', $(e.target).parent()); } },
            }
          });
          confirmModal.on('hidden.bs.modal', (e) => { 
            console.log('Graffiti: escaped the removeGraffitiWithPrompt modal.');
          });
        }
      },

      updateAllGraffitiDisplays: () => {
        graffiti.refreshAllGraffitiHighlights();
        graffiti.refreshGraffitiTips();
      },

      //
      // Recording control functions
      //

      setPendingRecording: () => {
        if (state.getActivity() === 'recording') {
          graffiti.toggleRecording(); // stop current recording
        } else {
          console.log('Setting pending recording');
          graffiti.changeActivity('recordingPending');
          state.restoreCellStates('selections'); // reset selections to when you clicked to begin the recording
        }
      },

      beginMovieRecordingProcess: () => {
        // Preserve the state of all cells and selections before we begin recording so we can restore when the recording is done.
        state.storeCellStates();
        graffiti.editGraffiti('recordingLabelling');
      },

      addCMEventsToSingleCell: (cell) => {
        graffiti.CMEvents[cell.metadata.cellId] = true;
        const cm = cell.code_mirror;
        cm.on('focus', (cm, e) => {
          console.log('CM focus:' , cm, e);
          // Check to see if we jumped from another cell to this cell with the arrow keys. If we did and we're recording, we need to
          // create a focus history record because jupyter is not firing the select cell event in those cases.
          if (state.getActivity() === 'recording') {
            if (cell.metadata.cellId !== state.getSelectedCellId()) {
              state.saveSelectedCellId(cell.metadata.cellId);
              state.storeHistoryRecord('focus');
            }
          }
          if (state.getActivity() === 'recordingPending') {
            console.log('Graffiti: Now starting movie recording');
            graffiti.toggleRecording();
          }
          graffiti.updateControlPanels(cm); // this is necessary since a focus change can happen when you arrow advance from one cell to the next cell
        });

        cm.on('cursorActivity', (cm, e) => {
          //console.log('cursorActivity');
          if (state.getActivity() === 'idle') {
            graffiti.updateControlPanels(cm); // this is necessary because you can move the cursor from inside a graffiti to outside one
          }
          //console.log('graffiti.selectedTokens:', graffiti.selectedTokens);
          const affectedCell = utils.findCellByCodeMirror(cm);
          state.storeCellIdAffectedByActivity(affectedCell.metadata.cellId);
          state.storeHistoryRecord('selections');
        });

        cm.on('change', (cm, changeObj) => {
          //console.log('change activity:', changeObj);
          const affectedCell = utils.findCellByCodeMirror(cm);
          state.storeCellIdAffectedByActivity(affectedCell.metadata.cellId);
          state.storeHistoryRecord('contents');
          if (state.getActivity() === 'idle') {
            graffiti.refreshGraffitiHighlights({cell: affectedCell, clear: true});
          }
        });

        cm.on('mousedown', (cm, e) => {
          //console.log('mousedown, e:', e);
        });

        cm.on('refresh', (cm, e) => {
          //console.log('**** CM refresh event ****');
        });

        cm.on('update', (cm, e) => {
          //console.log('**** CM update event ****');
          graffiti.refreshGraffitiTips();
        });

        cm.on('scroll', (cm, e) => {
          const pointerPosition = state.getPointerPosition();
          const viewInfo = utils.collectViewInfo(pointerPosition.y, 
                                                 graffiti.notebookPanel.height(), 
                                                 graffiti.sitePanel.scrollTop(),
                                                 state.getGarnishing(),
                                                 state.getGarnishStyle());
          state.storeViewInfo(viewInfo);
          state.storeHistoryRecord('innerScroll');
        });

      },

      addCMEventsToCells: () => {
        const inputCells = Jupyter.notebook.get_cells();
        for (let cell of inputCells) {
          // Don't rebind if already bound
          if (!graffiti.CMEvents.hasOwnProperty(cell.metadata.cellId)) {
            graffiti.addCMEventsToSingleCell(cell);
          }
        }
      },

      // Bind all select, create, delete, execute  cell events at the notebook level
      addCMEvents: () => {
        graffiti.addCMEventsToCells();

        Jupyter.notebook.events.on('select.Cell', (e, cell) => {
          //console.log('cell select event fired, e, cell:',e, cell.cell);
          //console.log('select cell store selections');
          state.storeHistoryRecord('focus');
          graffiti.refreshGraffitiTips();
        });

        Jupyter.notebook.events.on('create.Cell', (e, results) => {
          //console.log('create.Cell fired');
          //console.log(results);
          const newCell = results.cell;
          const newCellIndex = results.index;
          newCell.metadata.cellId = utils.generateUniqueId();
          utils.refreshCellMaps();
          graffiti.addCMEventsToSingleCell(newCell);
          state.storeHistoryRecord('contents');
        });

        Jupyter.notebook.events.on('delete.Cell', (e) => {
          utils.refreshCellMaps();
          graffiti.pausePlayback();
          state.storeHistoryRecord('contents');
        });

        Jupyter.notebook.events.on('finished_execute.CodeCell', (e, results) => {
          console.log('Finished execution event fired, e, results:',e, results);
          utils.refreshCellMaps();
          state.storeHistoryRecord('contents');
        });

        Jupyter.notebook.events.on('rendered.MarkdownCell', (e, results) => {
          const activity = state.getActivity();
          if ((activity === 'graffiting') || (activity === 'recordingLabelling')) { 
            const lastEditActivityTime = state.getLastEditActivityTime();
            if (lastEditActivityTime !== undefined && utils.getNow() - lastEditActivityTime > 250) {
              console.log('rendered MarkdownCell event fired and editing with long enough delay, so finishing graffiti. e, results:',e, results);
              graffiti.finishGraffiti(true);
              state.clearLastEditActivityTime();
            }
          }
        });

        Jupyter.notebook.events.on('shell_reply.Kernel', (e, results) => {
          console.log('Kernel shell reply event fired, e, results:',e, results);
          utils.refreshCellMaps();
          if (state.getStorageInProcess()) {
            storage.clearStorageInProcess();
            graffiti.updateAllGraffitiDisplays();
            graffiti.updateControlPanels(); // necessary because we just finished a save
          }
        });

      },


      toggleRecording: () => {
        const currentActivity = state.getActivity();
        if (currentActivity !== 'playing') {
          if (currentActivity === 'recording') {

            //
            // Stop movie recording currently underway.
            //

            graffiti.clearAllCanvases();
            if (graffiti.recordingIndicatorInterval !== undefined) {
              clearInterval(graffiti.recordingIndicatorInterval);
              graffiti.recordingIndicatorInterval = undefined;
            }
            state.finalizeHistory();
            state.dumpHistory();
            clearInterval(state.getRecordingInterval());
            // This will use the callback defined in setAudioStorageCallback to actually persist everything.
            audio.stopRecording();
            //$('#recorder-range').removeAttr('disabled');
            console.log('Graffiti: toggleRecording refreshing.');
            state.restoreCellStates('contents');
            graffiti.updateAllGraffitiDisplays();
            graffiti.sitePanel.animate({ scrollTop: state.getScrollTop() }, 750);
            state.restoreCellStates('selections');
            state.deleteTrackingArrays();
            graffiti.changeActivity('idle');
            console.log('Graffiti: Stopped recording.');
          } else {

            //
            // Start new movie recording.
            //

            const recordingCellInfo = state.getRecordingCellInfo();
            if (recordingCellInfo == undefined) {
              // Error condition, cannot start recording without an active cell
              console.log('Cannot begin recording, no cell chosen to store recording.');
              return;
            }
            console.log('Begin recording for cell id:', recordingCellInfo.recordingCellId);

            graffiti.changeActivity('recording');
            state.setMovieRecordingStarted(true);
            state.assignCellIds();
            state.initHistory({
              storageCellId: recordingCellInfo.recordingCellId,
            });

            audio.startRecording();
            $('#recorder-range').attr('disabled',1);
            state.setScrollTop(graffiti.sitePanel.scrollTop());
            state.setGarnishing(false);

            state.setRecordingInterval(
              setInterval(() => {
                //console.log('Moving time ahead.');
                graffiti.updateTimeDisplay(state.getTimeRecordedSoFar());
              }, 10)
            );
            graffiti.recordingIndicatorInterval = setInterval(() => {
              if (state.getTimeRecordedSoFar() % 2000 > 1000) {
                $('#graffiti-recording-flash-icon').css({background:'rgb(245,245,245)'});
              } else {
                $('#graffiti-recording-flash-icon').css({background:'rgb(255,0,0)'});
              }
            }, 1000);
            console.log('Started recording');
          }
        }
      },


      changeActivity: (newActivity) => {
        if (state.getActivity() === newActivity) {
          console.log('Graffiti: state is already :', newActivity, 'not changing it');
          return; // no change to activity
        }
        state.setActivity(newActivity);
        graffiti.updateControlPanels();
      },

      //
      // Movie playback code begins
      //

      updateFocus: (index) => {
        const focusRecord = state.getHistoryItem('focus', index);
        const currentlySelectedCell = Jupyter.notebook.get_selected_cell();
        if (currentlySelectedCell.metadata.hasOwnProperty('cellId') && currentlySelectedCell.metadata.cellId !== focusRecord.activeCellId) {
          const activeCellIndex = utils.findCellIndexByCellId(focusRecord.activeCellId); // we should use a map to speed this up
          Jupyter.notebook.select(activeCellIndex);
          const activeCell = utils.findCellByCellId(focusRecord.activeCellId);
          if (activeCell !== undefined) {
            activeCell.code_mirror.focus();
          }
        }
      },


      updatePointer: (record) => {
        if (record.hoverCell !== undefined) {
          const hoverCellElement = $(record.hoverCell.element[0]);
          const cellRect = hoverCellElement[0].getBoundingClientRect();
          const innerCell = hoverCellElement.find('.inner_cell')[0];
          const innerCellRect = innerCell.getBoundingClientRect();
          //console.log('hoverCellId:', record.hoverCell.metadata.cellId, 'rect:', innerCellRect);
          const dxScaled = parseInt(innerCellRect.width * record.dx);
          const dyScaled = parseInt(innerCellRect.height * record.dy);
          const offsetPosition = {
            x : innerCellRect.left + dxScaled,
            y : innerCellRect.top + dyScaled
          };
          const lastPosition = state.getLastRecordingCursorPosition();
          const lastGarnishInfo = state.getLastGarnishInfo();
          if (record.garnishing) {
            //console.log('lastGarnishInfo:', lastGarnishInfo);
            graffiti.placeCanvas(record.cellId,record.garnishStyle);
            graffiti.setCanvasStyle(record.cellId, record.garnishStyle);
            // We are currently garnishing, so draw next portion of garnish on canvas.
            //console.log('garnishing from:', lastGarnishInfo.x, lastGarnishInfo.y, '->', dxScaled, dyScaled);
            const garnishOffset = { x: dxScaled + (innerCellRect.left - cellRect.left), y: dyScaled + (innerCellRect.top - cellRect.top) };
            if (lastGarnishInfo.garnishing && lastGarnishInfo.garnishCellId == record.cellId) {
              graffiti.updateGarnishDisplay(record.cellId, lastGarnishInfo.x, lastGarnishInfo.y, garnishOffset.x + 0.5, garnishOffset.y + 0.5, record.garnishStyle);
            }
            state.setLastGarnishInfo(garnishOffset.x, garnishOffset.y, record.garnishing, record.garnishStyle, record.cellId);
          } else {
            if (lastGarnishInfo.garnishing) {
              // garnish rendering just ended
              state.setLastGarnishInfo(dxScaled, dyScaled, record.garnishing, record.garnishStyle, record.cellId);
            }
          }
          if ((offsetPosition.x !== lastPosition.x) || (offsetPosition.y !== lastPosition.y)) {
            // Show cursor whenever it's moved by user
            //console.log('Showing cursor:', offsetPosition, lastPosition);
            const offsetPositionPx = { left: offsetPosition.x + 'px', top: offsetPosition.y + 'px'};
            graffiti.graffitiCursor.css(offsetPositionPx);
          }            
          state.setLastRecordingCursorPosition(offsetPosition);
        }
      },

      updateView: (viewIndex) => {
        let record = state.getHistoryItem('view', viewIndex);
        record.hoverCell = utils.findCellByCellId(record.cellId);

        // Select whatever cell is currently selected
        if (record.selectedCellId !== undefined) {
          const selectedCellIndex = utils.findCellIndexByCellId(record.selectedCellId); // we should use a map to speed this up
          //console.log('about to select index:', selectedCellIndex)
          Jupyter.notebook.select(selectedCellIndex);
          const selectedCell = utils.findCellByCellId(record.selectedCellId);
          if (selectedCell !== undefined) {
            selectedCell.code_mirror.focus();
          }
        }

        if (record.pointerUpdate) {
          //console.log('pointerUpdate is true, record:', record);
          graffiti.graffitiCursor.show();
          graffiti.updatePointer(record);
        } else {
          graffiti.graffitiCursor.hide();
        }

        // Update innerScroll if required
        if (record.hoverCell) {
          const cm = record.hoverCell.code_mirror;
          cm.scrollTo(record.innerScroll.left, record.innerScroll.top);


          // Compute mapped scrollTop for this timeframe
          const currentNotebookPanelHeight = graffiti.notebookPanel.height();
          const scrollRatio = record.scrollTop / record.notebookPanelHeight;
          const mappedScrollTop = scrollRatio * currentNotebookPanelHeight;

          // Compute offset to hoverCell from history value mapped to current panel height, to current cell position
          const hoverCellElement = $(record.hoverCell.element[0]);
          const hoverCellTop = hoverCellElement.position().top;
          const mappedTop = (record.cellPositionTop / record.notebookPanelHeight) * currentNotebookPanelHeight;
          const positionDifference = hoverCellTop - mappedTop;

          // Compute difference in cell sizes of the history hoverCell size to current cell size, and subtract half of that difference
          // in order to offset cell size changes
          const mappedHeight = record.innerCellRect.height * (record.notebookPanelHeight / currentNotebookPanelHeight);
          const heightDiff = $(hoverCellElement.find('.inner_cell')[0]).height() - mappedHeight;
          const heightDiffAdjustment = -0.5 * heightDiff;

          // Now the updated scrollTop is computed by adding all three values together.
          const scrollTop = parseInt(mappedScrollTop + positionDifference + heightDiffAdjustment);

          const currentScrollTop = graffiti.sitePanel.scrollTop();
          if (currentScrollTop !== scrollTop) {
            graffiti.sitePanel.scrollTop(scrollTop);
          }
        }
      },

      updateSelections: (index) => {
        // Preserve scrollTop position because latest CM codebase sometimes seems to change it when you setSelections.
        const currentScrollTop = graffiti.sitePanel.scrollTop();
        
        const record = state.getHistoryItem('selections', index);
        let cellId, cell, selections, code_mirror, currentSelections, active, selectionsUpdateThisFrame = false;
        for (cellId of Object.keys(record.cellsSelections)) {
          selections = record.cellsSelections[cellId].selections;
          active = record.cellsSelections[cellId].active;
          cell = utils.findCellByCellId(cellId);
          if (cell !== undefined) {
            code_mirror = cell.code_mirror;
            currentSelections = utils.cleanSelectionRecords(code_mirror.listSelections());
            //console.log('cellId, selections, currentSelections:', cellId, selections, currentSelections);
            if (!(_.isEqual(selections,currentSelections))) {
              //console.log('updating selection, rec:', record, 'sel:', selections, 'cell:', cell);
              graffiti.graffitiCursor.hide();
              code_mirror.setSelections(selections);
              selectionsUpdateThisFrame = true;
            }
          }
        }
        if (selectionsUpdateThisFrame) {
          // This code restores page position after a selection is made; updating selections causes Jupyter to scroll randomly, see above
          if (graffiti.sitePanel.scrollTop() !== currentScrollTop) {
            // console.log('Graffiti: Jumped scrolltop');
            graffiti.sitePanel.scrollTop(currentScrollTop);
            graffiti.graffitiCursor.hide();
          }
        }
      },

      // Also, store outputs in content records and when a cell is executed create a content record.
      // On output change, back reference should be updated as well as contents change.

      updateContents: (index) => {
        const contentsRecord = state.getHistoryItem('contents', index);
        const cells = Jupyter.notebook.get_cells();
        let cellId, contents, outputs, frameContents, frameOutputs;
        for (let cell of cells) {
          if (cell.cell_type === 'code') {
            cellId = cell.metadata.cellId;
            contents = cell.get_text();
            outputs = cell.output_area.outputs;
            if (contentsRecord.cellsContent.hasOwnProperty(cellId)) {
              frameContents = state.extractDataFromContentRecord(contentsRecord.cellsContent[cellId].contentsRecord, cellId);
              if (frameContents !== undefined && frameContents !== contents) {
                cell.set_text(frameContents);
              }
              frameOutputs = state.extractDataFromContentRecord(contentsRecord.cellsContent[cellId].outputsRecord, cellId);
              if (frameOutputs !== undefined && frameOutputs.length > 0 && (!(_.isEqual(outputs, frameOutputs)))) {
                cell.clear_output();
                const output_type = frameOutputs[0].output_type;
                if ((output_type === 'display_data' || output_type === 'stream') || (output_type === 'error')) {
                  if ((output_type === 'stream') ||
                      (output_type === 'error') ||
                      (frameOutputs[0].hasOwnProperty('data') && !frameOutputs[0].data.hasOwnProperty('application/javascript'))) {
                    cell.output_area.handle_output({header: { msg_type: frameOutputs[0].output_type }, content: frameOutputs[0]});
                  }
                }
              }
            }
          }
        }
      },

      updateDisplay: (frameIndexes) => {
        graffiti.updateContents(frameIndexes.contents);
        graffiti.updateSelections(frameIndexes.selections);
        graffiti.updateView(frameIndexes.view);
      },

      // update the timer display for play or recording
      updateTimeDisplay: (playedSoFar) => {
        const timeDisplay = utils.formatTime(playedSoFar);
        let recorderTimeDisplay;
        if (state.getActivity() === 'recording') {
          recorderTimeDisplay = $('#graffiti-time-display-recording');
        } else {
          recorderTimeDisplay = $('#graffiti-time-display-playback');
        }
        recorderTimeDisplay.text(timeDisplay);
        /*
           // Update recording flasher icon. Restore this someday maybe...
           const now = utils.getNow();
           if (now % 1000 < 500) {
           $('#recorder-flasher').hide();
           } else {
           $('#recorder-flasher').show();
           }
         */
      },

      updateSlider: (playedSoFar) => {
        const ratio = playedSoFar / state.getHistoryDuration();
        const sliderVal = ratio * 1000;
        //console.log('updateSlider, playedSoFar:', playedSoFar, 'sliderVal:', sliderVal);
        const slider = $('#graffiti-recorder-range');
        slider.val(sliderVal);
      },

      //
      // Playback functions
      //

      jumpPlayback: (direction) => {
        graffiti.pausePlayback();
        const timeElapsed = state.getPlaybackTimeElapsed();
        const t = Math.max(0, Math.min(timeElapsed + (graffiti.rewindAmt * 1000 * direction), state.getHistoryDuration() - 1 ));
        console.log('t:', t);
        const frameIndexes = state.getHistoryRecordsAtTime(t);
        state.clearSetupForReset();
        state.setPlaybackTimeElapsed(t);
        graffiti.updateDisplay(frameIndexes);
        graffiti.updateSlider(t);
        graffiti.updateTimeDisplay(t);
        graffiti.updateAllGraffitiDisplays();
      },

      handleSliderDrag: () => {
        // Handle slider drag
        const target = $('#graffiti-recorder-range');
        const timeLocation = target.val() / 1000;
        //console.log('slider value:', timeLocation);
        state.clearSetupForReset();
        graffiti.graffitiCursor.show();
        const t = Math.min(state.getHistoryDuration() * timeLocation, state.getHistoryDuration() - 1);
        // Now we need to set the time we are going to start with if we play from here.
        state.setPlaybackTimeElapsed(t);
        const frameIndexes = state.getHistoryRecordsAtTime(t);
        graffiti.updateDisplay(frameIndexes);
        graffiti.updateTimeDisplay(t);
      },

      pausePlaybackNoVisualUpdates: () => {
        clearInterval(state.getPlaybackInterval());
        graffiti.changeActivity('playbackPaused');
        audio.pausePlayback();
        state.setPlaybackTimeElapsed();
      },

      // Pause any ongoing playback
      pausePlayback: () => {
        if (state.getActivity() !== 'playing')
          return;

        graffiti.pausePlaybackNoVisualUpdates();

        graffiti.refreshAllGraffitiHighlights();
        graffiti.refreshGraffitiTips();

        // Save after play stops, so if the user reloads we don't get the annoying dialog box warning us changes were made.
        // graffiti.saveNotebook();

        console.log('Graffiti: Stopped playback.');
      },

      cancelPlaybackNoVisualUpdates: () => {
        graffiti.pausePlaybackNoVisualUpdates();
        state.setGarnishing(false);
        state.resetPlayState();
        graffiti.changeActivity('idle');
        state.restoreCellStates('contents');
        utils.saveNotebook();
        state.restoreCellStates('selections');
      },

      cancelPlayback: (opts) => {
        const activity = state.getActivity();
        if ((activity !== 'playing') && (activity !== 'playbackPaused')) {
          return;
        }

        console.log('Graffiti: Cancelling playback');
        graffiti.cancelPlaybackNoVisualUpdates();
        graffiti.graffitiCursor.hide();
        graffiti.clearAllCanvases();
        graffiti.refreshAllGraffitiHighlights();
        graffiti.refreshGraffitiTips(); 
        graffiti.updateControlPanels();
        graffiti.highlightIntersectingGraffitiRange();

        if (opts.cancelAnimation) {
          graffiti.sitePanel.animate({ scrollTop: state.getScrollTop() }, 750);
        }
      },

      startPlayback: () => {
        // start playback
        console.log('Graffiti: Starting playback.');
        const activity = state.getActivity();
        if (activity === 'idle') {
          // If just starting to play back, store all cells current contents so we can restore them when you cancel playback.
          utils.saveNotebook();
          state.setLastGarnishInfo(0,0,false, 'highlight'); // make sure we've turned off any garnishing flag from a previous interrupted playback
          state.setScrollTop(graffiti.sitePanel.scrollTop());
          state.storeCellStates();
        }

        graffiti.clearAllCanvases();
        graffiti.clearHighlightMarkText();
        graffiti.graffitiCursor.show();
        graffiti.changeActivity('playing');

        if (state.resetOnNextPlay) {
          console.log('Resetting for first play.');
          state.resetPlayState();
        }

        state.setPlaybackStartTime(new Date().getTime() - state.getPlaybackTimeElapsed());

        if (!state.getMute()) {
          audio.startPlayback(state.getPlaybackTimeElapsed());
        }

        // Set up main playback loop on a 10ms interval
        state.setPlaybackInterval(
          setInterval(() => {
            //console.log('Moving time ahead.');
            const playedSoFar = state.getTimePlayedSoFar();
            if (playedSoFar >= state.getHistoryDuration()) {
              // reached end of recording naturally, so set up for restart on next press of play button
              state.setupForReset();
              graffiti.togglePlayback();
            } else {
              graffiti.updateSlider(playedSoFar);
              graffiti.updateTimeDisplay(playedSoFar);
              const frameIndexes = state.getHistoryRecordsAtTime(playedSoFar);
              graffiti.updateDisplay(frameIndexes);
            }
          }, 10)
        );
      },

      togglePlayback: () => {
        const activity = state.getActivity();
        if (activity !== 'recording') {
          if (activity === 'playing') {
            graffiti.pausePlayback();
          } else {
            graffiti.startPlayback();
          }
        }
      },

      loadAndPlayMovie: (kind) => {
        const playableMovie = state.getPlayableMovie(kind);
        if (playableMovie === undefined) {
          console.log('Graffiti: no playable movie defined.');
          return;
        }
        graffiti.cancelPlayback({cancelAnimation:false}); // cancel any ongoing movie playback b/c user is switching to a different movie
        storage.loadMovie(playableMovie.cellId, playableMovie.recordingKey).then( () => {
          console.log('Graffiti: Movie loaded for cellId, recordingKey:', playableMovie.cellId, playableMovie.recordingKey);
          graffiti.togglePlayback();
          graffiti.hideTip();
        }).catch( (ex) => {
          dialog.modal({
            title: 'Movie is not available.',
            body: 'We are sorry, we could not load this movie at this time. Please contact the author of this Notebook for help.',
            sanitize:false,
            buttons: {
              'OK': { click: (e) => { console.log('Missing movie acknowledged.'); } }
            }
          });

          console.log('could not load movie:', ex);
        });

      },

      playRecordingById: (recordingFullId) => {
        const parts = recordingFullId.split('_');
        const cellId = 'id_' + parts[0];
        const recordingKey = 'id_' + parts[1];
        state.setPlayableMovie('api', cellId,recordingKey);
        graffiti.loadAndPlayMovie('api');
      },

      playRecordingByIdWithPrompt: (recordingFullId, promptMarkdown) => {
        const promptHtml = '<span>' + utils.renderMarkdown(promptMarkdown) + '</span>';
        
        // now set the notification and the state to 'notifying' with the entire notification being clickable to start it up
        // graffiti.playRecordingById(recordingFullId);

      },

      changeAccessLevel: (level) => {
        if (level === 'create') {
          graffiti.cancelPlayback({cancelAnimation:true});
          if (!state.getAudioInitialized()) {
            audio.init();
            state.setAudioInitialized();
          }
          state.setAuthorId(0); // currently hardwiring this to creator(teacher) ID, which is always 0. Eventually we will replace this with 
          // individual author ids
          storage.ensureNotebookGetsGraffitiId();
          state.assignCellIds();
          utils.saveNotebook();
          graffiti.refreshAllGraffitiHighlights();
          graffiti.refreshGraffitiTips();
        } else {
          graffiti.outerControlPanel.fadeOut(graffiti.panelFadeTime);          
        }
        state.setAccessLevel(level); 
        graffiti.updateControlPanels();
      },
    };

    // Functions exposed externally to the Python API.
    return {
      init: graffiti.init,
      graffiti:graffiti, // remove me
      playRecordingById: (recordingFullId) => { graffiti.playRecordingById(recordingFullId) },
      playRecordingByIdWithPrompt: (recordingFullId, promptMarkdown) => { graffiti.playRecordingByIdWithPrompt(recordingFullId, promptMarkdown) },
      cancelPlayback: () => { graffiti.cancelPlayback({cancelAnimation:false}) },
      removeAllGraffitis: graffiti.removeAllGraffitisWithConfirmation,
      setAccessLevel: (level) => { graffiti.changeAccessLevel(level) },
      setAuthorId: (authorId) => { state.setAuthorId(authorId) },
    }

  })();

  return Graffiti;

});
