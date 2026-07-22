function beginDrag(pointer, widgetPosition) {
    return {
        offsetX: pointer.x - widgetPosition.x,
        offsetY: pointer.y - widgetPosition.y
    };
}

function dragTarget(pointer, session) {
    return {
        x: pointer.x - session.offsetX,
        y: pointer.y - session.offsetY
    };
}

module.exports = { beginDrag, dragTarget };
