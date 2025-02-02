const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const GObject = imports.gi.GObject;

var MenuItem = GObject.registerClass(
    class MenuItemPopup extends PopupMenu.PopupBaseMenuItem {

    _init(icon, key, label, value) {
	super._init({ reactive: true });

        this._checked = false;
        this._key = key;
        this._gIcon = icon;

        this._labelActor = new St.Label({ text: label });
        this.add(new St.Icon({ style_class: 'popup-menu-icon', gicon : this._gIcon }));
        this.add(this._labelActor, { x_fill: true, expand: true });
        this._valueLabel = new St.Label({ text: value });
        this.add(this._valueLabel);
    }

    set checked(checked) {
        if (checked)
            this.setOrnament(PopupMenu.Ornament.CHECK);
        else
            this.setOrnament(PopupMenu.Ornament.NONE);

        this._checked = checked;
    }

    get checked() {
        return this._checked;
    }

    get key() {
        return this._key;
    }

    set display_name(text) {
        return this._labelActor.text = text;
    }

    get gicon() {
        return this._gIcon;
    }

    set value(value) {
        this._valueLabel.text = value;
    }

    get value() {
        return this._valueLabel.text;
    }
});
