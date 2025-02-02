const St = imports.gi.St;
const Lang = imports.lang;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
Me.imports.helpers.polyfills;
const Sensors = Me.imports.sensors;
const Convenience = Me.imports.helpers.convenience;
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;
const MessageTray = imports.ui.messageTray;
const Values = Me.imports.values;
const Config = imports.misc.config;

let MenuItem, vitalsMenu;

const VitalsMenuButton = new Lang.Class({
    Name: 'VitalsMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(St.Align.START);

        this._settings = Convenience.getSettings();

        this._sensorIcons = {
            'temperature' : { 'icon': 'temperature-symbolic.svg',
                       'alphabetize': true },
                'voltage' : { 'icon': 'voltage-symbolic.svg',
                       'alphabetize': true },
                    'fan' : { 'icon': 'fan-symbolic.svg',
                       'alphabetize': true },
                 'memory' : { 'icon': 'memory-symbolic.svg',
                       'alphabetize': true },
              'processor' : { 'icon': 'cpu-symbolic.svg',
                       'alphabetize': true },
                 'system' : { 'icon': 'system-symbolic.svg',
                       'alphabetize': true },
                'network' : { 'icon': 'network-symbolic.svg',
                       'alphabetize': true,
                     'icon-download': 'network-download-symbolic.svg',
                       'icon-upload': 'network-upload-symbolic.svg' },
                'storage' : { 'icon': 'storage-symbolic.svg',
                       'alphabetize': true },
                'battery' : { 'icon': 'battery-symbolic.svg',
                       'alphabetize': true }
        }

        this._warnings = [];
        this._sensorMenuItems = {};
        this._hotLabels = {};
        this._hotIcons = {};
        this._groups = {};

        this._update_time = this._settings.get_int('update-time');

        this._sensors = new Sensors.Sensors(this._settings, this._sensorIcons);
        this._values = new Values.Values(this._settings, this._sensorIcons);
        this._menuLayout = new St.BoxLayout({ style_class: 'vitals-panel-box' });

        this._drawMenu();

        if (ExtensionUtils.versionCheck(['3.18', '3.20', '3.22', '3.24', '3.26', '3.28', '3.30', '3.32'], Config.PACKAGE_VERSION)) {
            this.actor.add_actor(this._menuLayout);
        } else {
            this.add_actor(this._menuLayout);
        }

        this._settingChangedSignals = [];
        this._addSettingChangedSignal('update-time', Lang.bind(this, this._updateTimeChanged));
        this._addSettingChangedSignal('position-in-panel', Lang.bind(this, this._positionInPanelChanged));
        this._addSettingChangedSignal('use-higher-precision', Lang.bind(this, this._higherPrecisionChanged));

        let settings = [ 'alphabetize', 'include-public-ip', 'hide-zeros', 'unit', 'network-speed-format' ];
        for (let setting of Object.values(settings))
            this._addSettingChangedSignal(setting, Lang.bind(this, this._redrawMenu));

        // add signals for show- preference based categories
        for (let sensor in this._sensorIcons)
            this._addSettingChangedSignal('show-' + sensor, Lang.bind(this, this._showHideSensorsChanged));

        this._initializeMenu();
        this._initializeTimer();
    },

    _initializeMenu: function() {
        // display sensor categories
        for (let sensor in this._sensorIcons) {
            // groups associated sensors under accordion menu
            if (typeof this._groups[sensor] != 'undefined') continue;

            this._groups[sensor] = new PopupMenu.PopupSubMenuMenuItem(_(this._ucFirst(sensor)), true);
            this._groups[sensor].icon.gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[sensor]['icon']);

            // hide menu items that user has requested to not include
            if (!this._settings.get_boolean('show-' + sensor))
                this._groups[sensor].actor.hide(); // 3.34?

            if (!this._groups[sensor].status) {
                this._groups[sensor].status = this._defaultLabel();
                this._groups[sensor].actor.insert_child_at_index(this._groups[sensor].status, 4); // 3.34?
                this._groups[sensor].status.text = 'No Data';
            }

            this.menu.addMenuItem(this._groups[sensor]);
        }

        let panelSystem = Main.panel.statusArea.aggregateMenu._system;
        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            style_class: 'vitals-menu-button-container'
        });

        // round preferences button
        let prefsButton = panelSystem._createActionButton('preferences-system-symbolic', _("Preferences"));
        prefsButton.connect('clicked', function() {
            Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
        });
        item.actor.add(prefsButton, { expand: true, x_fill: false }); // 3.34?

        // round monitor button
        let monitorButton = panelSystem._createActionButton('utilities-system-monitor-symbolic', _("System Monitor"));
        monitorButton.connect('clicked', function() {
            Util.spawn(["gnome-system-monitor"]);
        });
        item.actor.add(monitorButton, { expand: true, x_fill: false }); // 3.34?

        // round refresh button
        let refreshButton = panelSystem._createActionButton('view-refresh-symbolic', _("Refresh"));
        refreshButton.connect('clicked', Lang.bind(this, function(self) {
            this._sensors.resetHistory();
            this._values.resetHistory();
            this._updateTimeChanged();
        }));
        item.actor.add(refreshButton, { expand: true, x_fill: false }); // 3.34?

        // add separator and buttons
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(item);
    },

    _removeMissingHotSensors: function(hotSensors) {
        for (let i = hotSensors.length - 1; i >= 0; i--) {
            let sensor = hotSensors[i];

            // make sure default icon (if any) stays visible
            if (sensor == '_default_icon_') continue;

            if (!this._sensorMenuItems[sensor]) {
                hotSensors.splice(i, 1);
                this._removeHotLabel(sensor);
                this._removeHotIcon(sensor);
            }
        }

        return hotSensors;
    },

    _saveHotSensors: function(hotSensors) {
        this._settings.set_strv('hot-sensors', hotSensors.filter(
            function(item, pos) {
                return hotSensors.indexOf(item) == pos;
            }
        ));
    },

    _initializeTimer: function() {
        // start off with fresh sensors
        this._querySensors();

        // used to query sensors and update display
        this._refreshTimeoutId = Mainloop.timeout_add_seconds(this._update_time, Lang.bind(this, function() {
            this._querySensors();

            // keep the timer running
            return true;
        }));
    },

    _createHotItem: function(key, gicon, value) {
        let icon = this._defaultIcon(gicon);
        this._hotIcons[key] = icon;
        this._menuLayout.add(icon);

        // don't add a label when no sensors are in the panel
        if (key == '_default_icon_') return;

        let label = new St.Label({
            text: (value)?value:'\u2026', // ...
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER
        });

        this._hotLabels[key] = label;
        this._menuLayout.add(label);
    },

    _higherPrecisionChanged: function() {
        this._sensors.resetHistory();
        this._values.resetHistory();
        this._querySensors();
    },

    _showHideSensorsChanged: function(self, sensor) {
        this._groups[sensor.substr(5)].visible = this._settings.get_boolean(sensor);
    },

    _positionInPanelChanged: function() {
        this.container.get_parent().remove_actor(this.container);

        // small HACK with private boxes :)
        let boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox
        };

        let p = this.positionInPanel;
        boxes[p].insert_child_at_index(this.container, p == 'right' ? 0 : -1)
    },

    _removeHotLabel: function(key) {
        if (typeof this._hotLabels[key] != 'undefined') {
            let label = this._hotLabels[key];
            delete this._hotLabels[key];
            // make sure set_label is not called on non existant actor
            label.destroy();
        }
    },

    _removeHotLabels: function() {
        for (let key in this._hotLabels)
            this._removeHotLabel(key);
    },

    _removeHotIcon: function(key) {
        if (typeof this._hotIcons[key] != 'undefined') {
            this._hotIcons[key].destroy();
            delete this._hotIcons[key];
        }
    },

    _removeHotIcons: function() {
        for (let key in this._hotIcons)
            this._removeHotIcon(key);
    },

    _redrawMenu: function() {
        this._removeHotIcons();
        this._removeHotLabels();

        for (let key in this._sensorMenuItems) {
            if (key.includes('-group')) continue;
            this._sensorMenuItems[key].destroy();
            delete this._sensorMenuItems[key];
        }

        this._drawMenu();
        this._sensors.resetHistory();
        this._values.resetHistory();
        this._querySensors();
    },

    _drawMenu: function() {
        // grab list of selected menubar icons
        let hotSensors = this._settings.get_strv('hot-sensors');
        for (let key of Object.values(hotSensors))
            this._createHotItem(key);
    },

    _updateTimeChanged: function() {
        this._update_time = this._settings.get_int('update-time');
        this._sensors.update_time = this._update_time;

        // invalidate and reinitialize timer
        Mainloop.source_remove(this._refreshTimeoutId);

        this._initializeTimer();
    },

    _addSettingChangedSignal: function(key, callback) {
        this._settingChangedSignals.push(this._settings.connect('changed::' + key, callback));
    },

    _updateDisplay: function(label, value, type, key) {
        //global.log('...label=' + label, 'value=' + value, 'type=' + type, 'key=' + key);

        // update sensor value in menubar
        if (this._hotLabels[key])
            this._hotLabels[key].set_text(value);

        // have we added this sensor before?
        let item = this._sensorMenuItems[key];
        if (item) {
            // update sensor value in the group
            item.value = value;
        } else if (type.includes('-group')) {
            // update text next to group header
            let group = type.split('-')[0];
            if (this._groups[group]) {
                this._groups[group].status.text = value;
                this._sensorMenuItems[type] = this._groups[group];
            }
        } else {
            let sensor = { 'label': label, 'value': value, 'type': type }
            this._appendMenuItem(sensor, key);
        }
    },

    _appendMenuItem: function(sensor, key) {
        let split = sensor.type.split('-');
        let type = split[0];
        let icon = (typeof split[1] != 'undefined')?'icon-' + split[1]:'icon';
        let gicon = Gio.icon_new_for_string(Me.path + '/icons/' + this._sensorIcons[type][icon]);

        let item = new MenuItem.MenuItem(gicon, key, sensor.label, sensor.value);
        item.connect('activate', Lang.bind(this, function(self) {
            let hotSensors = this._settings.get_strv('hot-sensors');

            if (self.checked) {
                self.checked = false;

                // remove selected sensor from panel
                hotSensors.splice(hotSensors.indexOf(self.key), 1);
                this._removeHotLabel(self.key);
                this._removeHotIcon(self.key);
            } else {
                self.checked = true;

                // add selected sensor to panel
                hotSensors.push(self.key);
                this._createHotItem(self.key, self.gicon, self.value);
            }

            if (hotSensors.length <= 0) {
                // add generic icon to panel when no sensors are selected
                hotSensors.push('_default_icon_');
                this._createHotItem('_default_icon_');
            } else {
                let defIconPos = hotSensors.indexOf('_default_icon_');
                if (defIconPos >= 0) {
                    // remove generic icon from panel when sensors are selected
                    hotSensors.splice(defIconPos, 1);
                    this._removeHotIcon('_default_icon_');
                }
            }

            // removes any sensors that may not currently be available
            hotSensors = this._removeMissingHotSensors(hotSensors);

            // this code is called asynchronously - make sure to save it for next round
            this._saveHotSensors(hotSensors);

            return true;
        }));

        if (this._hotLabels[key]) {
            item.checked = true;
            if (this._hotIcons[key])
                this._hotIcons[key].gicon = item.gicon;
        }

        this._sensorMenuItems[key] = item;
        let i = Object.keys(this._sensorMenuItems[key]).length;

        // alphabetize the sensors for these categories
        if (this._sensorIcons[type]['alphabetize'] && this._settings.get_boolean('alphabetize')) {
            let menuItems = this._groups[type].menu._getMenuItems();
            for (i = 0; i < menuItems.length; i++)
                // use natural sort order for system load, etc
                if (typeof menuItems[i] != 'undefined' && typeof menuItems[i].key != 'undefined' && menuItems[i].key.localeCompare(key, undefined, { numeric: true, sensitivity: 'base' }) > 0)
                    break;
        }

        this._groups[type].menu.addMenuItem(item, i);
    },

    _defaultLabel: function() {
        return new St.Label({
            style_class: 'vitals-status-menu-item',
               y_expand: true,
                y_align: Clutter.ActorAlign.CENTER
        });
    },

    _defaultIcon: function(gicon) {
        let icon = new St.Icon({
            icon_name: "utilities-system-monitor-symbolic",
          style_class: 'system-status-icon'
        });

        if (gicon) icon.gicon = gicon;
        return icon;
    },

    _ucFirst: function(string) {
      return string.charAt(0).toUpperCase() + string.slice(1);
    },

    get positionInPanel() {
        let positions = [ 'left', 'center', 'right' ];
        return positions[this._settings.get_int('position-in-panel')];
    },

    _querySensors: function() {
        this._sensors.query(Lang.bind(this, function(label, value, type, format) {
            let key = '_' + type.split('-')[0] + '_' + label.replace(' ', '_').toLowerCase() + '_';

/*
            if (key == '_temperature_package_id 0_' && value >= 50000)
                this._warnings.push(label + ' is ' + value);

            if (key == '_system_load_1m_' && value >= 2)
                this._warnings.push(label + ' is ' + value);
*/

            let items = this._values.returnIfDifferent(label, value, type, format, key);
            for (let item of Object.values(items))
                this._updateDisplay(_(item[0]), item[1], item[2], item[3]);
        }));

        if (this._warnings.length > 0) {
            this._notify("Vitals", this._warnings.join("\n"), 'folder-symbolic');
            this._warnings = [];
        }
    },

    _notify: function(msg, details, icon) {
        let source = new MessageTray.Source("MyApp Information", icon);
        Main.messageTray.add(source);
        let notification = new MessageTray.Notification(source, msg, details);
        notification.setTransient(true);
        source.notify(notification);
    },

    destroy: function() {
        Mainloop.source_remove(this._refreshTimeoutId);

        for (let signal of Object.values(this._settingChangedSignals))
            this._settings.disconnect(signal);

        // Call parent
        this.parent();
    }
});

function init() {
    Convenience.initTranslations();

    // load correct menuItem depending on Gnome version
    if (ExtensionUtils.versionCheck(['3.18', '3.20', '3.22', '3.24', '3.26', '3.28'], Config.PACKAGE_VERSION)) {
        MenuItem = Me.imports.menuItemLegacy;
    } else if (ExtensionUtils.versionCheck(['3.30', '3.32'], Config.PACKAGE_VERSION)) {
        MenuItem = Me.imports.menuItemOld;
    } else {
        MenuItem = Me.imports.menuItem;
    }
}

function enable() {
    vitalsMenu = new VitalsMenuButton();
    let positionInPanel = vitalsMenu.positionInPanel;
    Main.panel.addToStatusArea('vitalsMenu', vitalsMenu, positionInPanel == 'right' ? 0 : -1, positionInPanel);
}

function disable() {
    vitalsMenu.destroy();
    vitalsMenu = null;
}
